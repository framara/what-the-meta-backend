# TODO: WoW Leaderboard Frontend Web App

## Goal
Build a modern, responsive frontend website to visualize World of Warcraft leaderboard statistics using the /meta/ endpoints from the API proxy. The site should provide rich, interactive data visualizations and allow users to filter and explore the data by season, period, and dungeon.

---

## Features & Requirements

### 1. General
- Responsive design (mobile, tablet, desktop)
- Clean, modern UI/UX (easy to use and understand)
- Fast, dynamic updates (no full page reloads)
- Accessible (a11y best practices)
- Dark/light mode toggle (optional)

### 2. Filters
- **Season** (dropdown, default to 14)
- **Period** (all or specific, dropdown)
- **Dungeon** (all or specific, dropdown)
- Filters update all visualizations and lists dynamically

### 3. Visualizations
- **X/Y Graphs** (e.g., keystone level vs. score, completions over time)
- **Pie/Slice Charts** (e.g., class/spec distribution, role distribution)
- **Bar Charts** (e.g., top dungeons by completions, top specs)
- **Lists/Tables**
  - Top dungeons (by completions, by score)
  - Most played specs/classes
  - Top runs (with group composition)
- All charts/lists update based on filters

### 4. Pages/Sections
- **Dashboard**: Overview stats, quick filters, key charts
- **Dungeons**: Detailed stats per dungeon (with filter)
- **Specs/Classes**: Popularity, performance, distribution
- **Runs/Leaderboard**: List of top runs, sortable/filterable
- **About/Info**: Project info, data source, credits

### 5. Technical
- Use React (recommended) or another modern JS framework
- Use a charting library (e.g., Chart.js, Recharts, D3, ECharts)
- Fetch data from /meta/top-keys and related endpoints
- State management for filters (React Context, Redux, or similar)
- Loading/error states for all data fetches
- Environment config for API base URL
- (Optional) Deployable as static site (Vercel, Netlify, etc.)

### 6. Stretch Goals
- User can bookmark/share filtered views (URL params)
- Export charts/data as images or CSV
- User feedback or voting on "most interesting runs"
- Animations/transitions for chart updates

---

## Project Roadmap

1. **Design wireframes/mockups for main pages and filter UI**
2. **Set up project structure and dependencies**
3. **Implement API client and filter state management**
4. **Build filter UI and connect to API**
5. **Implement main dashboard and charts**
6. **Add detailed pages (dungeons, specs, runs)**
7. **Polish UI/UX, add responsiveness and accessibility**
8. **Testing and bugfixes**
9. **Deploy and document**

---

## Notes
- All data comes from the backend /meta/ endpoints (see API_DOCUMENTATION.md)
- Focus on season 14 for now, but design for future seasons
- Prioritize usability and clarity in all visualizations
