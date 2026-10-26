# Gate ראשי על שרת Oracle, ו־Modal כגיבוי (מ־2026-10-27)

## זרימה

Proxy ← **Oracle** `https://shiurim.ysho.uk/lhg-gate/check` (timeout ‏`LHG_GATE_ORACLE_TIMEOUT_MS=800`)
← אם נכשל, חרג מהזמן או החזיר 3xx: **Modal** (`LHG_GATE_URL`, ‏1500ms) ← אם גם הוא נכשל: muse-spark.
`p < 0.2` מכל אחד מהם חוסך את הקריאה למודל. ה־Gate יכול רק לחסוך קריאה, לעולם לא להסתיר.
התשובה של `/check` כוללת `gateBy` (`oracle` / `modal` / null).

`/warm` שולח ping ל־Oracle בלבד. רק אם Oracle לא עונה, הוא מעיר את Modal, כך שבזמן רגיל Modal ישן ולא עולה כסף.

## מדידה (2026-10-27, ‏297 הודעות `eval_codex_v2`, ‏fp32 v2)

| threads (cores) | batch 1 p50 / p95 | בדיקות לשנייה | batch 8 p50 / p95 | בדיקות לשנייה |
|---|---|---|---|---|
| 1 | 146 / 183ms | 6.9 | 874 / 1033ms | 9.0 |
| **2 (פעיל)** | **92 / 113ms** | 10.8 | 459 / 546ms | 17.1 |
| 4 | 63 / 102ms | 14.9 | 268 / 336ms | 28.4 |

- התאמה ל־Modal בסף 0.2: ‏297/297 בכל התצורות. הפרש מקסימלי בהסתברות: פחות מ־0.00001.
- HTTP מקומי (2 threads): p50 102ms, ‏p95 120ms. דרך ה־Tunnel מ־BI-1: ‏p50 174ms, ‏p95 287ms, ‏200/200 תואמות.
- השפעה על השרת: brain-mcp ו־brain-main (`/sse`, ‏401 מהאפליקציה) נשארו ב־p95 של 2–3ms, לפני הריצה ובמהלכה.
  ה־load הגיע לכל היותר ל־2.6 עם 4 threads, ול־1.0 בשימוש HTTP עם 2 threads. הזיכרון של הקונטיינר כ־260MiB.

## הפעלה (`classifier/oracle/`)

- על Oracle, בתיקייה `/home/ubuntu/lhg-gate`: יושבים שם `models/v2` (מתוך `py -m modal volume get lhg-models /v2 .`),
  `server.py`, `bench.py`, `Dockerfile` ו־`deploy.sh`. מפעילים: `bash deploy.sh <tag>`.
- הקונטיינר `lhg-gate`: ‏`--cpuset-cpus 2-3 --memory 2g`, ‏`--restart unless-stopped`, ומאזין רק על `127.0.0.1:8090`.
- המפתח נשמר רק ב־`/home/ubuntu/lhg-gate/gate.env` (הרשאות 600). ב־Worker הוא נשמר כ־secret ‏`LHG_GATE_ORACLE_KEY`, דרך `wrangler secret bulk`.
- החשיפה החוצה: path rule ב־tunnel הקיים `shiurim` (`/home/ubuntu/cf-shiurim/config.yml`, ‏`^/lhg-gate(/|$)` → ‏`127.0.0.1:8090`).
  גיבוי של הקובץ: `config.yml.bak-before-lhg-gate`.
- מדידה חוזרת: `bench.py` בתוך ה־image, ‏`http_bench.py` מכל מחשב, ‏`modal_ref.py` לציוני הייחוס של Modal.

## החלפה וכיבוי

- חזרה ל־Modal בלבד: למחוק את `LHG_GATE_ORACLE_URL` מ־`proxy/wrangler.toml` ולפרוס.
- Oracle בלבד: למחוק את `LHG_GATE_URL`.
- כיבוי ה־Gate כולו: למחוק את שני ה־URL.

## מלכודות שאומתו

- `cloudflared tunnel route dns` עם `yonicc-cert.pem` נכשל ב־`Authentication error`: ל־cert אין הרשאת DNS.
  גם ה־API token הישן של shiurim מחזיר 403. לכן אין hostname ייעודי, והפתרון הוא path rule על shiurim.
  נוצר tunnel ריק בשם `lhg-gate` (`1ba90649-…`), והקרדנציאלס שלו נמצאות ב־`/home/ubuntu/lhg-gate/tunnel/`. כדי לעבור ל־hostname ייעודי
  צריך CNAME אחד: `lhg-gate.ysho.uk` → `<id>.cfargotunnel.com`.
- tunnel שמוגדר מקומית לא טוען מחדש את ה־config. כדי שלא תהיה הפסקה: מעלים connector זמני עם ה־config החדש, עושים `docker restart cf-shiurim`, ואז מסירים את הזמני.
  shiurim ענה 78/78 בקשות ב־200 בזמן ההחלפה.
- `/health` של brain מחזיר 307 מ־nginx ולא מודד את האפליקציה. צריך למדוד את `/sse` (‏401).
- ב־BI-1, פקודה שמועברת ב־pipe מ־PowerShell אל `ssh 'bash -s'` מגיעה עם BOM ו־CRLF. לכן מעתיקים את הסקריפט עם `scp` ומריצים אותו שם.
