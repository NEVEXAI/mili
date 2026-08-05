# GitHub Manual Upload Guide

## Required final structure

```text
repository-root/
├── .nojekyll
├── index.html
├── README.md
├── QA_REPORT.md
├── DEPLOYMENT_GUIDE.md
├── assets/
│   ├── app.js
│   └── styles.css
├── data/
│   ├── schema.json
│   └── chunks/
│       ├── sites_01.json
│       ├── sites_02.json
│       └── ...all 16 chunk files...
└── scripts/
    └── validate_repository.py
```

Do not create `data/data/chunks`, and do not place chunk files at the repository root.

## GitHub Pages

Use:

`Settings → Pages → Deploy from a branch → main → / (root)`

No GitHub Actions workflow is required.
