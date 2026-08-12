# Hunar AI Hiring Assistant

A web application for the assignment:

1. AI Hiring Assistant using Hunar Voice AI Agents.
2. People Search & Reachout using Apollo People Search plus Hunar voice reachout, with CSV/manual candidate intake as the approved workaround when people-search API access is blocked.
3. A concrete HR attendance-tracking solution for 1000 people across 100 locations without smartphones.

## What it does

- Paste a job description and search for matching candidates via Apollo when a paid Apollo API key is available.
- Generate public sourcing search links from the job description.
- Import callable candidates by CSV or add candidates manually.
- Request Apollo phone enrichment for selected candidates when search results do not include phone numbers.
- Save candidates to a dashboard.
- Select a Hunar Voice AI agent and caller number.
- Start single or bulk reachout calls through Hunar.
- Sync Hunar call statuses and structured conversation results back into the dashboard.
- Accept Hunar webhooks at `/api/webhooks/hunar`.
- Includes a dedicated attendance-tracking proposal page matching the third assignment prompt.

## Security

API keys are read only from environment variables on the server. They are never committed or exposed to browser code.

## Environment variables

Copy `.env.example` to `.env` locally, then set:

- `HUNAR_API_KEY`
- `APOLLO_API_KEY`
- optional `HUNAR_DEFAULT_AGENT_ID`
- optional `HUNAR_DEFAULT_FROM_PHONE_NUMBER`
- optional `HUNAR_WEBHOOK_SECRET`
- `APP_BASE_URL` set to your deployed origin, for example `https://your-app.onrender.com`

Apollo People Search does not return phone numbers by default. This app uses Apollo People Enrichment for selected dashboard candidates. Phone enrichment requires `APP_BASE_URL` because Apollo returns mobile numbers asynchronously to `/api/webhooks/apollo`.

## Approved workaround note

Apollo's People Search and People Enrichment APIs are not available on the free plan, and PDL/Proxycurl/Coresignal did not allow personal-email signup. Hunar replied: "Anything works. You can proceed with whatever seems feasible for you."

Because of that approval, the deployed demo can be run end-to-end with CSV/manual candidate intake while preserving the required Hunar Voice AI reachout and dashboard workflow.

CSV columns:

```csv
name,title,company,location,email,phone,linkedinUrl
```

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

## Deploy

This app uses only Node.js built-ins, so it can be deployed to Render, Railway, Fly.io, an EC2 instance, or any Node host.

Set the environment variables in your deployment provider before starting the app.

Start command:

```bash
npm start
```

## API references used

- Hunar Voice Agents external API: `https://api.voice.hunar.ai/docs/external/`
- Apollo People API Search: `https://docs.apollo.io/reference/people-api-search`
