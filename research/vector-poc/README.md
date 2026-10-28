# Vector POC — מדידת זיכרון וקטורי מקומי (סינתטי בלבד)

לא חלק מהתוסף החי. הרצה: `npm install` ואז `node bench.mjs 2000` (או `20000`).

מודד: טעינת `Xenova/multilingual-e5-small` (quantized, dim=384), זמן embedding,
brute-force cosine מול Voy (recall@10) ומול Orama BM25 מילולי, על תבניות עבריות סינתטיות.
תוצאות מדודות (Node 24, BI-1): ראה docs/33.
