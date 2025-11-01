# Twitch AI Chatbot

An AI-powered analytics and companion app for Twitch streamers that analyzes chat messages in real-time and provides intelligent answers about chat activity, sentiment, and engagement.

## 🎯 Overview

This full-stack application allows streamers to:
- **Log in to a web dashboard** to interact with their chat analytics
- **Ask natural language questions** like "What's the vibe in chat today?" or "Who was the first person to say hello?"
- **Get AI-generated answers** powered by Gemini/OpenAI based on their stored Twitch chat logs
- **View real-time chat analysis** with session-based insights

## 🏗️ Architecture

The application consists of three main components:

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Twitch    │─────▶│  ECS Fargate  │─────▶│  DynamoDB   │
│    Chat     │      │  (Ingest Bot) │      │  (Storage)  │
└─────────────┘      └──────────────┘      └─────────────┘
                                                      │
                                                      ▼
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   React     │─────▶│ API Gateway   │─────▶│   Lambda    │
│  Frontend   │      │  + Lambda     │      │  (Backend)  │
└─────────────┘      └──────────────┘      └─────────────┘
                                                      │
                                                      ▼
                                              ┌─────────────┐
                                              │ Gemini/     │
                                              │ OpenAI API  │
                                              └─────────────┘
```

### Components

1. **ECS Fargate Bot** (`ecs_node/`)
   - Connects to Twitch IRC to monitor chat messages
   - Parses and stores all messages in DynamoDB
   - Runs continuously in a Docker container

2. **Lambda Backend** (`backend/lambda/`)
   - Single `/chat/ask` endpoint that handles all AI-powered questions
   - Fetches Twitch stream metadata to determine session start time
   - Retrieves chat logs from DynamoDB for the current streaming session
   - Sends context + question to AI (Gemini or OpenAI)
   - Returns intelligent answers based on chat analysis

3. **React Frontend** (`frontend/`)
   - Interface for streamer interaction
   - Real-time messages
   - Auto-scrolling chat transcript
   - Responsive design with Twitch-themed styling

## ✨ Features

- **Session-based analysis**: Automatically determines stream start time and analyzes only messages from the current session
- **Dual AI support**: Choose between Gemini (default) or OpenAI models
- **Natural language queries**: Ask any question about your chat:
  - "What was the funniest message?"
  - "How many unique chatters have I had?"
  - "What's the vibe in chat today?"
  - "What did @username say?"
- **Real-time chat ingestion**: All messages logged automatically
- **Secure secrets management**: API keys stored in AWS Secrets Manager
- **Production-ready**: Scalable, serverless architecture

## 🛠️ Tech Stack

### Backend
- **Language**: Python 3.11
- **AWS Services**:
  - Lambda (serverless compute)
  - API Gateway (HTTP endpoints)
  - DynamoDB (chat log storage)
  - ECS Fargate (bot container)
  - Secrets Manager (API key storage)
- **AI Models**: Google Gemini 2.5 Flash (default) or OpenAI GPT-4o-mini
- **Frameworks**: boto3, google-generativeai, openai

### Frontend
- **Language**: TypeScript
- **Framework**: React 18
- **Build Tool**: Vite
- **Hosting**: AWS Amplify (or S3 + CloudFront)

### Bot
- **Language**: Node.js 18
- **Runtime**: Docker container on ECS Fargate
- **Libraries**: AWS SDK v3, TLS (built-in)

## 📁 Project Structure

```
Twitch_AI_chatbot/
├── backend/              # Lambda backend code
│   ├── lambda/
│   │   └── chat_ask.py   # Main Lambda handler
│   ├── requirements.txt  # Python dependencies
│   └── serverless.yml   # Serverless Framework config
├── ecs_node/             # ECS Fargate bot
│   ├── bot.js           # Twitch IRC bot
│   ├── Dockerfile       # Container definition
│   └── package.json     # Node.js dependencies
├── frontend/             # React frontend
│   ├── src/
│   │   ├── App.tsx      # Main React component
│   │   ├── api.ts       # API client
│   │   └── styles.css   # Styling
│   ├── vite.config.ts  # Vite config
│   └── package.json     # Dependencies
└── README.md            # This file
```