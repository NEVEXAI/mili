# MILI Explorer 2.2 — Montréal Agglomeration UX Edition

A static GitHub Pages property-intelligence application covering **336,878 unique physical assessment sites** across the Montréal agglomeration.

## Version 2.2 improvements

- Search suggestions remain visible while results update and disappear only after selection, Escape, clearing the search, or clicking outside the search area.
- Keyboard navigation for autocomplete suggestions.
- Grouped and collapsible dynamic filters.
- Live filtering with a short debounce.
- Removable active-filter chips.
- Improved result cards with opportunity, risk and confidence.
- Property-detail tabs and score explanation.
- Clear source/calculated/not-available labels.
- Fit-map-to-results button.
- Excel export of all matches.
- PDF search report and single-property PDF report.
- CSV, GeoJSON and KML exports removed.

## Deploy

Upload the repository contents so `index.html` is at the repository root, then use:

`Settings → Pages → Deploy from a branch → main → / (root)`

## External libraries

The application loads Leaflet, MarkerCluster, SheetJS, jsPDF and jsPDF-AutoTable from public CDNs. Internet access is required for the map and export libraries.
