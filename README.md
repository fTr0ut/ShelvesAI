# ShelvesAI

Mobile-first app for cataloging and sharing physical collections.

## Architecture

- **Mobile**: Expo/React Native app (`/mobile`)
- **API**: Node.js/Express backend (`/api`)
- **Database**: MongoDB (migrating to PostgreSQL)

## Quick Start

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL - Phase 1)
- Expo CLI

### Development

```bash
# Start API
cd api && npm install && npm run dev

# Start mobile (in separate terminal)
cd mobile && npm install && npx expo start
```

## Project Structure

```
ShelvesAI/
├── api/                 # Express backend
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── services/
│   └── server.js
├── mobile/              # Expo app
│   └── src/
├── storyboards/         # Implementation plans
└── README.md
```

## Implementation Phases

See `/storyboards/readme.md` for the full implementation roadmap.
