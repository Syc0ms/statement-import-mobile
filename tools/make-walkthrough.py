"""Builds a captioned step-by-step walkthrough video from raw simulator recordings.

Usage: python3 -I tools/make-walkthrough.py <recordings_dir> <evidence_dir> <out.mp4>

Each scenario becomes a 1920x1080 segment: the recording on the right, and on the
left the scenario title, numbered steps, and the real /__test/state counters
before/after (read from the evidence JSON files). Frozen frames are dropped so the
video shows only what changes on screen. Needs ffmpeg (overlay, mpdecimate) and Pillow.
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
CANVAS = (245, 244, 240)
INK = (28, 27, 24)
INK2 = (92, 90, 84)
ACCENT = (45, 92, 76)
DANGER = (162, 57, 43)
FONT_PATH = "/System/Library/Fonts/SFNS.ttf"


def font(size, weight="Regular"):
    f = ImageFont.truetype(FONT_PATH, size)
    try:
        f.set_variation_by_name(weight)
    except (OSError, ValueError):
        pass
    return f


SCENARIOS = [
    {
        "clip": "01-happy.mov",
        "before": "01-happy-before.json",
        "after": "01-happy-after.json",
        "title": "1 · happy",
        "subtitle": "Полный импорт и удаление",
        "steps": [
            "Системный picker → statement.csv (112 Б)",
            "Проверка на устройстве: CSV по содержимому, не по расширению",
            "Ключ операции сохранён до POST; 202 → «В очереди», не «готово»",
            "Опрос: processing → ready, ревизия 3 → 151.99 AUD в месяц",
            "«Подробнее» — карточка списания, отмены подписки нет",
            "Удаление: 202 deleting → GET deleted, ревизия 5",
        ],
    },
    {
        "clip": "02-lost-ack-relaunch.mov",
        "before": "02-lost-ack-before.json",
        "after": "02-lost-ack-after.json",
        "title": "2 · lost_ack + перезапуск",
        "subtitle": "Ответ на POST потерян, приложение убито",
        "steps": [
            "Тест-панель: сценарий lost_ack",
            "statement.pdf → «Отправить»: mock создал задание, сокет оборван",
            "Экран: «Исход отправки неизвестен», файл сам не переотправляется",
            "Приложение убито до проверки (simctl terminate) и открыто снова",
            "Восстановление: запись с ключом → GET by-key → опрос → ready",
            "Одно задание: newJobs = 1, повторных POST нет",
        ],
    },
    {
        "clip": "03-stale-status.mov",
        "before": "03-stale-before.json",
        "after": "03-stale-after.json",
        "title": "3 · stale_status",
        "subtitle": "Устаревшая ревизия после ready",
        "steps": [
            "Тест-панель: сценарий stale_status",
            "statement.csv → первый GET сразу ready, ревизия 3",
            "«Обновить статус» → сервер присылает processing, ревизия 2",
            "Экран остаётся «Отчёт готов»: ревизия 2 < 3 проигнорирована",
            "На шаге «Готово»: «устаревший processing/2 проигнорирован»",
        ],
    },
    {
        "clip": "04-delete-failure.mov",
        "before": "04-delete-failure-before.json",
        "after": "04-delete-failure-after.json",
        "title": "4 · delete_failure",
        "subtitle": "Удаление не удалось, затем повтор",
        "steps": [
            "Тест-панель: сценарий delete_failure",
            "«Удалить с сервера» → 503: «Не удалено, данные остаются на сервере»",
            "Задание на mock по-прежнему ready",
            "Тест-панель: happy → «Повторить удаление» тем же ключом",
            "202 deleting → GET deleted (ревизия 5) → «Удалено с сервера»",
            "Ключ удаления тот же, попыток 2",
        ],
    },
    {
        "clip": "05-spoofed-oversize.mov",
        "before": "05-local-reject-before.json",
        "after": "05-local-reject-after.json",
        "title": "5 · spoofed + oversize",
        "subtitle": "Отказ на устройстве до POST",
        "steps": [
            "spoofed.pdf: расширение .pdf, но содержимое не %PDF- → отказ",
            "oversize.csv: 10 485 771 байт > 10 МиБ по метаданным → отказ",
            "Содержимое большого файла не читалось",
            "Временные копии удалены, на сервер ничего не ушло",
            "createRequests до и после одинаковый",
        ],
    },
]

COUNTERS = ["createRequests", "newJobs", "duplicateHits", "acceptedBytes", "deleteRequests"]


def wrap(draw, text, fnt, width):
    words, lines, line = text.split(), [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def panel(scn, before, after, out_png):
    img = Image.new("RGB", (W, H), CANVAS)
    d = ImageDraw.Draw(img)
    x, y, width = 90, 80, 1180
    d.text((x, y), "Импорт выписки · iOS Simulator", font=font(30, "Semibold"), fill=INK2)
    y += 70
    d.text((x, y), scn["title"], font=font(72, "Bold"), fill=INK)
    y += 100
    d.text((x, y), scn["subtitle"], font=font(36), fill=INK2)
    y += 80
    step_font = font(34)
    for i, step in enumerate(scn["steps"], 1):
        d.ellipse((x, y + 2, x + 44, y + 46), fill=ACCENT)
        num = str(i)
        d.text((x + 22 - d.textlength(num, font=font(26, "Semibold")) / 2, y + 7), num, font=font(26, "Semibold"), fill=(255, 255, 255))
        for j, line in enumerate(wrap(d, step, step_font, width - 80)):
            d.text((x + 70, y + j * 44), line, font=step_font, fill=INK)
        y += 44 * max(1, len(wrap(d, step, step_font, width - 80))) + 20
    # counters table
    y = max(y + 20, 760)
    d.rounded_rectangle((x - 20, y - 20, x + width, y + 230), radius=22, fill=(255, 255, 255))
    d.text((x, y), "GET /__test/state", font=font(26, "Semibold"), fill=INK2)
    d.text((x + 520, y), "до", font=font(26, "Semibold"), fill=INK2)
    d.text((x + 760, y), "после", font=font(26, "Semibold"), fill=INK2)
    mono = ImageFont.truetype("/System/Library/Fonts/SFNSMono.ttf", 28)
    for k, name in enumerate(COUNTERS):
        yy = y + 42 + k * 36
        b, a = before["stats"][name], after["stats"][name]
        d.text((x, yy), name, font=mono, fill=INK)
        d.text((x + 520, yy), str(b), font=mono, fill=INK)
        d.text((x + 760, yy), str(a), font=mono, fill=ACCENT if a != b else INK)
    jobs = ", ".join(f"{j['jobId']}: {j['status']}/{j['revision']}" for j in after["jobs"]) or "заданий нет"
    d.text((x, y + 245), f"mock после: {jobs}", font=font(26), fill=INK2)
    img.save(out_png)


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    rec_dir, ev_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
    tmp = tempfile.mkdtemp(prefix="walkthrough-")
    parts = []
    for i, scn in enumerate(SCENARIOS):
        clip = os.path.join(rec_dir, scn["clip"])
        if not os.path.exists(clip):
            print(f"skip {scn['clip']} (missing)")
            continue
        with open(os.path.join(ev_dir, scn["before"])) as f:
            before = json.load(f)
        with open(os.path.join(ev_dir, scn["after"])) as f:
            after = json.load(f)
        png = os.path.join(tmp, f"panel{i}.png")
        panel(scn, before, after, png)
        part = os.path.join(tmp, f"part{i}.mp4")
        # Phone video: drop frozen frames, scale to 960 px high, place on the right.
        vf = (
            "[0:v]mpdecimate=hi=64*24:lo=64*12:frac=0.5,setpts=N/30/TB,"
            "scale=-2:960,format=yuv420p[ph];"
            "[1:v][ph]overlay=x=W-w-120:y=60:shortest=1,format=yuv420p[v]"
        )
        run([
            "ffmpeg", "-y", "-i", clip, "-loop", "1", "-framerate", "30", "-i", png,
            "-filter_complex", vf, "-map", "[v]", "-r", "30", "-c:v", "libx264",
            "-crf", "26", "-preset", "veryfast", "-an", part,
        ])
        parts.append(part)
        print(f"built {scn['clip']}")
    listing = os.path.join(tmp, "list.txt")
    with open(listing, "w") as f:
        for part in parts:
            f.write(f"file '{part}'\n")
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", "-movflags", "+faststart", out])
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
