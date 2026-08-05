# MILI Explorer 2.2 — Final Validation Report

## Final result

**PASS — ready for GitHub Pages deployment.**

## Dataset validation

- Total unique physical sites: **336,878**
- Data chunks: **16**
- Schema fields: **52**
- Dynamic filter fields: **44**
- Duplicate site IDs: **0**
- Malformed rows: **0**
- Missing schema-listed chunks: **0**

## Dynamic filter validation

All declared filter types were validated against every row:

- Numeric filters: **18**
- Boolean filters: **13**
- Category filters: **9**
- Text filters: **4**

Every filter field exists in the row schema and contains data compatible with its declared filter type.

## Exact preset regression counts

- All: **336,878**
- Residential 1–2: **228,738**
- V1 Screen: **2,035**
- Premium: **15**

## Functional code validation

- JavaScript syntax: **PASS**
- Dynamic filter generation: **PASS**
- Numeric min/max filtering logic present: **PASS**
- Boolean Any/Yes/No logic present: **PASS**
- Category filtering logic present: **PASS**
- Text contains filtering logic present: **PASS**
- Active-filter chips present: **PASS**
- Live filter updates present: **PASS**
- Address autocomplete present: **PASS**
- Autocomplete remains available until selection, Escape, clearing, or outside click: **PASS**
- Mouse and keyboard autocomplete controls present: **PASS**
- Excel export of all matches present: **PASS**
- Filtered-results PDF export present: **PASS**
- Single-property PDF export present: **PASS**
- CSV export removed: **PASS**
- GeoJSON export removed: **PASS**
- KML export removed: **PASS**
- Saved property notes present: **PASS**
- Fit map to results present: **PASS**

## Performance behavior

- All **336,878** rows participate in filtering.
- Result cards are capped at 250 for browser performance.
- Map markers are capped at 3,000 for browser performance.
- Excel export includes every matching row.
- PDF includes the search summary and the top 250 ranked matches.

## External dependencies

Leaflet, MarkerCluster, SheetJS, jsPDF and jsPDF-AutoTable load from public CDNs. The map and Excel/PDF export features require an internet connection.

## Important limitations

The system remains a screening tool. It does not independently confirm legal zoning, ownership, title, assessment dollar values, taxes, servitudes, FAR, height, setbacks, subdivision rights or permitted unit yield.


## Loading overlay correction

Fixed a CSS specificity issue where `.busy { display:flex }` overrode the HTML `hidden` attribute.
The loading overlay now disappears correctly when JavaScript sets `hidden = true`.

Required rule:

```css
.busy[hidden] { display: none !important; }
```
