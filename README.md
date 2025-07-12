# ChatSeller API

Backend API for ChatSeller - AI Commercial Agent platform.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- PostgreSQL (Supabase)

### Installation

```bash
# Clone the repository
git clone https://github.com/Dukka-ChatSeller/chatseller-api.git
cd chatseller-api

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your actual values

# Generate Prisma client
npm run db:generate

# Push database schema
npm run db:push

# Start development server
npm run dev
```

### Environment Setup

Create a `.env` file with:

```env
# Database (Supabase)
DATABASE_URL="your-supabase-connection-string"
SUPABASE_URL="your-supabase-url"
SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_KEY="your-service-key"

# OpenAI
OPENAI_API_KEY="your-openai-key"

# Security
JWT_SECRET="your-jwt-secret"
```

## 📁 Project Structure

```
src/
├── server.ts          # Main server file
├── routes/            # API routes
├── services/          # Business logic
├── middleware/        # Custom middleware
├── types/            # TypeScript types
└── utils/            # Utility functions

prisma/
├── schema.prisma     # Database schema
└── migrations/       # Database migrations
```

## 🛠 API Endpoints

### Health Check
- `GET /health` - Server health status

### Shops
- `GET /api/v1/shops/:shopId` - Get shop configuration
- `PUT /api/v1/shops/:shopId` - Update shop configuration

### Conversations
- `POST /api/v1/conversations` - Create new conversation
- `GET /api/v1/conversations/:id` - Get conversation details
- `WS /api/v1/conversations/:id/ws` - WebSocket for real-time chat

### Orders
- `POST /api/v1/orders` - Create new order
- `GET /api/v1/shops/:shopId/orders` - Get shop orders

### Analytics
- `POST /api/v1/analytics/events` - Track analytics event
- `GET /api/v1/shops/:shopId/analytics` - Get shop analytics

## 📊 Database Schema

The API uses PostgreSQL with Prisma ORM. Key models:

- **Shop**: Store configuration and settings
- **Conversation**: Chat sessions between visitors and AI
- **Message**: Individual messages in conversations
- **Order**: Collected order information
- **KnowledgeBase**: AI training data per shop
- **AnalyticsEvent**: Tracking and metrics

## 🧪 Development

```bash
# Development server with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Database operations
npm run db:generate    # Generate Prisma client
npm run db:push       # Push schema to database
npm run db:migrate    # Run migrations
npm run db:studio     # Open Prisma Studio

# Code quality
npm run lint          # ESLint
npm test             # Jest tests
```

## 🚀 Deployment

### Railway (Recommended)

1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on push

### Manual Deployment

```bash
# Build the project
npm run build

# Start production server
npm start
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `SUPABASE_URL` | Supabase project URL | ✅ |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | ✅ |
| `OPENAI_API_KEY` | OpenAI API key | ✅ |
| `JWT_SECRET` | JWT signing secret | ✅ |
| `PORT` | Server port (default: 3001) | ❌ |
| `NODE_ENV` | Environment (development/production) | ❌ |

### Security Features

- CORS protection
- Rate limiting
- Helmet security headers
- Row Level Security (RLS) with Supabase
- JWT authentication (planned)

## 📝 Next Features (Roadmap)

- [ ] OpenAI integration for AI responses
- [ ] Knowledge base semantic search
- [ ] Webhook system for external integrations
- [ ] Authentication middleware
- [ ] Advanced analytics
- [ ] Multi-language support
- [ ] Upselling logic engine

## 🐛 Debugging

```bash
# Enable debug logs
DEBUG=true npm run dev

# View database in browser
npm run db:studio

# Check API health
curl http://localhost:3001/health
```

## 📄 License

MIT License - see LICENSE file for details.
