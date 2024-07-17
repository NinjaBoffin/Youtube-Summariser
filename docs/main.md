# Youtube-Summariser Documentation

## Architecture Overview
Youtube-Summariser is a serverless function designed to run on platforms like Vercel. Main components:

1. API Handler: Processes requests and manages overall flow.
2. YouTube Transcript Fetcher: Retrieves video transcripts.
3. Transcript Chunker: Splits long transcripts into manageable chunks.
4. OpenAI Summarizer: Generates summaries using the GPT model.
5. Caching Layer: Stores results to improve performance.

## Main Functions

### `fetchTranscript(videoId)`
Fetches the transcript for a given YouTube video ID.

### `summarizeTranscript(transcript)`
Breaks down the transcript and generates summaries using OpenAI's API.

### `dynamicChunkTranscript(transcript)`
Splits the transcript into optimal chunks for summarization.

### `summarizeWithOpenAI(text, startTime, endTime, segmentLength)`
Sends a chunk of text to OpenAI for summarization.

## Project Structure
- `/api`: Contains the main serverless function
- `/docs`: Documentation files
- `package.json`: Project dependencies and scripts
- `README.md`: Project overview and setup instructions