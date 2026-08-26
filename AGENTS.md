# AGENTS Instructions

## Project Overview
Bhotekoshi River Flood Information & Management Dashboard (भोटेकोशी बाढी विपद् सूचना तथा व्यवस्थापन ड्यासबोर्ड).
A real-time, responsive web dashboard built with Python FastAPI backend and Devanagari/Nepali frontend UI.

## Testing Rules
Always run tests using Docker Compose as required by project guidelines:
```bash
docker-compose exec server pytest
```

## Data Management
The primary data store is `/data/disaster_data.json`. Any changes made to this file are dynamically served via the API (`/api/data`) and live-polled by the frontend dashboard.
