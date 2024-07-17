# Youtube-Summariser

Project for a YouTube video summariser

## Overview
Youtube-Summariser is a tool that automatically generates concise summaries of YouTube videos based on their transcripts. It uses OpenAI's GPT model to create accurate and coherent summaries, making it easier for users to quickly grasp the content of videos without watching them in full.

## Setup
1. Clone the repository:
   ```
   git clone https://github.com/your-username/Youtube-Summariser.git
   cd Youtube-Summariser
   ```
2. Install dependencies:
   ```
   npm install
   ```
3. Set up environment variables:
   Create a `.env` file in the root directory and add the following:
   ```
   OPENAI_API_KEY=your_openai_api_key
   YOUTUBE_API_KEY=your_youtube_api_key
   ```

## Usage
To summarize a YouTube video, use the following API endpoint:

```
GET /api/summarize?url=https://www.youtube.com/watch?v=VIDEO_ID
```

Replace `VIDEO_ID` with the actual YouTube video ID.

## API Endpoints
- `GET /api/summarize`: Summarizes a YouTube video
  - Query parameter: `url` (required) - The YouTube video URL

## Configuration
The following environment variables are required:
- `OPENAI_API_KEY`: Your OpenAI API key
- `YOUTUBE_API_KEY`: Your YouTube Data API key

## Dependencies
- youtube-transcript: For fetching video transcripts
- openai: For generating summaries
- axios: For making HTTP requests
- node-cache: For caching results

## Known Issues
- This is a personal project made with AI tools so its not going to be best to look at
- Very long videos (>1 hour) may take a while to process
- Some videos with auto-generated captions might produce less accurate summaries
