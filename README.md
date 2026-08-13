# Hunar AI Hiring Assistant

A lightweight web app for voice-driven candidate outreach using Hunar Voice AI.

## What it does

- Accepts a job title, location, and full job description.
- Imports candidates via CSV or manual entry.
- Lets you edit or delete imported/manual candidates before reachout.
- Displays selectable candidate cards in Step 2.
- Starts Hunar voice calls for selected candidates.
- Shows a live dashboard of calls, statuses, recordings, and structured results.
- Supports Hunar webhook sync for updated call information.

## Key features

- CSV/manual candidate intake without requiring Apollo search.
- Candidate edit/delete actions in the sourcing panel.
- Hunar agent and caller number selection.
- Simple call dashboard with completed and interested metrics.
- Structured result rendering in the dashboard.

## Requirements

- Node.js 18+

## Environment variables

Create a `.env` file with:

- `HUNAR_API_KEY` — required
- `HUNAR_DEFAULT_AGENT_ID` — optional
- `HUNAR_DEFAULT_FROM_PHONE_NUMBER` — optional
- `HUNAR_WEBHOOK_SECRET` — optional
- `APP_BASE_URL` — optional, useful for webhook callbacks in deployed environments

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Deployment

This app uses only Node.js built-ins, so it can run on Render, Railway, Fly.io, or any host that supports Node.

Set the required environment variables in your deployment provider and use:

```bash
npm start
```

## CSV format

Use this header row for CSV import:

```csv
name,title,company,location,email,phone,linkedinUrl
```

## Notes

- The app is designed to work with Hunar voice calls as the main outreach channel.
- Apollo search/enrichment is not required for the current CSV/manual workflow.
- Candidate data is imported into the browser and synced through the dashboard via the server.
