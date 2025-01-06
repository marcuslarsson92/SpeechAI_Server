SpeechAI Server
This repository contains the SpeechAI server code, a Node.js/Express application designed to provide speech-to-text, text-to-speech, and real-time answers from OpenAI for group conversation analysis. It integrates with Google Cloud services (Speech-to-Text, Text-to-Speech, and Firebase Realtime Database) as well as OpenAI’s GPT-based language models to deliver immediate insights and AI-driven responses in a collaborative environment.

Overview
SpeechAI Server provides endpoints to transcribe audio in real time, detect language via franc, answer user queries using OpenAI, and generate TTS (text-to-speech) audio. Its primary scenario is a “speech cafe” environment: a multi-user conversation where the AI remains passive until invoked by a keyword, “Hi speech AI.” It also stores conversation logs (with optional audio references) in Firebase Realtime Database, accommodating single or multi-user sessions and enabling real-time updates/answers.

Prerequisites
Before running the SpeechAI server, ensure you have:
Node.js (v14 or later recommended. We used v23)
npm for package management
Google Cloud account (for Speech-to-Text, TTS, and Storage)
Firebase project with Firebase Realtime Database and Firebase Admin SDK credentials
OpenAI API key (for GPT-based completions)
You also need two Google credential JSON files:

GOOGLE_APPLICATION_CREDENTIALS: Service Account key for Google’s Speech and TTS APIs.
FIREBASE_KEY: Service Account key for Firebase Admin SDK.

Dependencys to install:
npm install firebase-admin
npm install -g nodemon
npm install

Project Structure
A simplified layout of the repository:
speechai_server/
┣ src/
┃ ┣ server.js // Main Express app
┃ ┣ database.js // Firebase DB interactions
┃ ┣ promptutil.js // OpenAI/analysis utilities
┃ ┗ ...other code...
┣ package.json
┣ .env // Environment variables
┗ README.md // This file

You must create a .env file in the project root containing at least these variables:
OPENAI_API_KEY='sk-xxxxxxxxxxxxxxxxxxxxxxxxxxx'
GOOGLE_APPLICATION_CREDENTIALS='/path/to/gcloud/credentials.json' // Path to the JSON file with Google Cloud credentials (Speech-to-Text & TTS).
FIREBASE_KEY='/path/to/firebase/service-account.json' // Path to the JSON file with Firebase Admin credentials (Realtime Database + Storage bucket).
OPENAI_API_KEY: Your API key from OpenAI.

Installation and Setup
Clone the Repository
Install Git: Ensure you have Git installed on your system. You can verify this by running:
git --version
If not installed, visit git-scm.com for installation instructions.

Open a Terminal or Command Prompt: Navigate to the directory where you want the repository to live.
Run the Clone Command:
git clone https://github.com/marcuslarsson92/SpeechAI_Server
This downloads the project files into a new folder named after the repository.

Or go to: https://github.com/marcuslarsson92/SpeechAI_Server
Cloning from the GitHub Web Interface:
Navigate to the repository in your web browser.
Click the green Code button (usually near the top-right).
Choose HTTPS under "Clone" and either download the zip version or open in GitHub Desktop.

Create/Edit .env File
Add your credentials in .env. Example:
OPENAI_API_KEY='sk-xxxx'
GOOGLE_APPLICATION_CREDENTIALS='/Users/youruser/keys/gcloud.json'
FIREBASE_KEY='/Users/youruser/keys/firebase-adminsdk.json'
Ensure Credential Files Exist

GOOGLE_APPLICATION_CREDENTIALS must point to a valid Google service account JSON.
FIREBASE_KEY must point to your Firebase Admin SDK JSON with permission for your Realtime Database and Storage.

Start the Server
npm run dev
This launches the server on port 3001 by default.

Usage
After startup, SpeechAI listens on http://localhost:3001. You can call its endpoints—like /api/process-audio—to transcribe audio or retrieve conversation data from Firebase.

Send an MP3 via multipart/form-data to /api/process-audio.
Check if the transcription triggers “Hi speech AI.”
Server returns either:
No audio if user didn’t invoke “Hi speech AI” (or prompt is empty).
TTS MP3 audio with an OpenAI-based answer if “Hi speech AI” is invoked.
Conversation is stored in Realtime DB under Conversations or MultiUserConversations.
