# Splatterhouse — modern 3D foundation

Starter monorepo for a browser + Android action game prototype.

## Requirements
- Node.js 20+
- npm 10+
- Android Studio only when building the Android wrapper

## Run
```bash
npm install
npm run dev
```
Open the Vite URL shown in the terminal.

API:
```bash
npm run dev:api
```

## Android
```bash
npm run android:add
npm run build -w @splatterhouse/web
npm run android:sync
```
Then open `apps/web/android` in Android Studio.

## Firebase setup
Copy `apps/web/.env.example` to `apps/web/.env` and fill in the Firebase **web app** configuration.
Do not put service-account JSON, Admin SDK credentials, or service-role keys in this file.
The first prototype keeps guest progress locally. Firebase anonymous / Google authentication and Firestore persistence are enabled when the public web-app configuration is supplied. Linking a Google account from an anonymous session preserves that Firebase UID.

## Current prototype
- Babylon.js 3D training arena with Rick represented by a complete low-detail procedural humanoid (head, Terror Mask, torso, arms, hands, legs and boots).
- Keyboard movement (WASD / arrows), procedural walk cycle, short punch animation (J) and pause (Esc).
- Mobile touch controls.
- Local guest save: current stage, checkpoint, score, kills, deaths and unlocked stages.
- Firebase adapter for anonymous / Google sign-in and Firestore save/load.
- Fastify API starter with health endpoint.

The procedural Rick is a low-cost visual prototype: simplified chest/abdomen, restrained blood marks, low-segment geometry and a simple mask. It is designed to be replaced by a higher-quality rigged GLB while retaining the same gameplay interface. This is a technical foundation, not a recreation containing original copyrighted game assets. Add only assets you own or are licensed to use.

## Protótipo jogável — build 0.2.0

A interface inicial agora apresenta o botão **Iniciar jogo**. A primeira campanha contém:

1. **Fase 01 — Terreno da mansão:** rolagem horizontal estilo beat 'em up, dividida em muro gosmento, bosque de árvores e fachada/porta da mansão. Ao alcançar a porta, o jogo troca para a fase seguinte.
2. **Fase 02 — Interior da mansão:** salão em perspectiva 2,5D, com profundidade limitada para movimentação em um plano de combate.

Controles: A/D ou setas esquerda/direita para avançar; W/S ou setas cima/baixo para deslocamento de profundidade; J para ataque. A entrada na porta da mansão inicia a segunda fase automaticamente.

Os cenários e a versão de baixa qualidade de Rick são construídos proceduralmente com primitivas do Babylon.js. Esta build é uma base visual e de navegação: inimigos, progressão de combate, colisões ambientais, transições cinematográficas e conteúdo adicional das salas ainda serão implementados em etapas posteriores.
