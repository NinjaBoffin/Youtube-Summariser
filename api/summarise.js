const { YoutubeTranscript } = require('youtube-transcript');
const NodeCache = require('node-cache');
const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const cache = new NodeCache({ stdTTL: 3600 });
const analyticsCache = new NodeCache({ stdTTL: 86400 });

const MAX_CHUNK_LENGTH = 4000;
const MAX_TOKENS = 150;

module.exports = async (req, res) => {
    console.log('Function started');
    try {
        res.setHeader('Content-Type', 'application/json');

        const { url } = req.query;
        console.log('Function invoked with URL:', url);

        if (!url || !isValidYouTubeUrl(url)) {
            console.log('Invalid YouTube URL');
            return handleError(res, new Error('Invalid YouTube URL'));
        }

        const videoId = extractVideoId(url);
        console.log('Extracted Video ID:', videoId);

        if (!videoId) {
            console.log('Could not extract video ID');
            return handleError(res, new Error('Could not extract video ID'));
        }

        const cachedResult = cache.get(videoId);
        if (cachedResult) {
            console.log('Returning cached result');
            return res.status(200).json(cachedResult);
        }

        console.log('Fetching transcript');
        const transcript = await fetchTranscript(videoId);
        console.log('Transcript fetched, length:', transcript.length);

        validateVideoLength(transcript);

        console.log('Summarizing transcript');
        const summary = await summarizeTranscript(transcript);
        console.log('Summary generated:', summary);

        const result = {
            transcript: transcript.map(item => item.text).join(' '),
            summary: summary,
            message: `Transcript fetched and summarized for video: ${videoId}`,
            timestamp: new Date().toISOString()
        };

        cache.set(videoId, result);
        recordUsage(videoId);

        console.log('Sending successful response');
        return res.status(200).json(result);
    } catch (error) {
        console.error('Error in main function:', error);
        return handleError(res, error);
    }
};

function isValidYouTubeUrl(url) {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
    return youtubeRegex.test(url);
}

function extractVideoId(url) {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
}

async function fetchTranscript(videoId) {
    try {
        const transcriptArray = await YoutubeTranscript.fetchTranscript(videoId);
        if (!transcriptArray || transcriptArray.length === 0) {
            throw new Error('Empty transcript returned');
        }
        return transcriptArray.map(item => ({
            text: decodeHTMLEntities(item.text),
        }));
    } catch (error) {
        console.error('Error fetching transcript:', error);
        throw new Error(`Failed to fetch transcript: ${error.message}`);
    }
}

async function summarizeTranscript(transcript) {
    const fullTranscript = transcript.map(item => item.text).join(' ');
    const chunks = chunkTranscriptDynamically(fullTranscript);
    const summaries = [];

    for (const chunk of chunks) {
        try {
            const summary = await summarizeWithOpenAI(chunk);
            summaries.push(summary);
        } catch (error) {
            console.error('Error in OpenAI API call:', error.response ? error.response.data : error.message);
            summaries.push("Failed to generate summary for this chunk.");
        }
    }

    return summaries.join(' ');
}

async function summarizeWithOpenAI(text) {
    const prompt = `Summarize the following video transcript chunk. Provide a concise summary of the main points discussed:

Transcript chunk:
${text}

Summary:`;

    try {
        const response = await axios.post('https://api.openai.com/v1/engines/text-davinci-002/completions', {
            prompt: prompt,
            max_tokens: MAX_TOKENS,
            temperature: 0.5,
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].text.trim();
    } catch (error) {
        console.error('Error during OpenAI API call:', error.response ? error.response.data : error.message);
        throw error;
    }
}

function chunkTranscriptDynamically(transcript) {
    const chunks = [];
    let currentChunk = '';
    const words = transcript.split(' ');

    words.forEach(word => {
        if (currentChunk.length + word.length + 1 <= MAX_CHUNK_LENGTH) {
            currentChunk += ` ${word}`;
        } else {
            chunks.push(currentChunk.trim());
            currentChunk = word;
        }
    });

    if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

function validateVideoLength(transcript) {
    const MAX_TRANSCRIPT_LENGTH = 100000;
    const totalLength = transcript.reduce((sum, item) => sum + item.text.length, 0);
    if (totalLength > MAX_TRANSCRIPT_LENGTH) {
        throw new Error(`Video transcript is too long (${totalLength} characters). Maximum allowed is ${MAX_TRANSCRIPT_LENGTH} characters.`);
    }
}

function decodeHTMLEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&#x27': "'",
        '&#x2F': '/',
        '&#x60': '`',
        '&#x3D': '='
    };
    return text.replace(/&([^;]+);/g, (match, entity) => entities[match] || match);
}

function handleError(res, error) {
    console.error('Handling error:', error);

    const errorMessage = error.message || 'An unexpected error occurred';
    const timestamp = new Date().toISOString();

    let statusCode = 500;
    let responseBody = {
        error: 'An error occurred in the serverless function',
        details: errorMessage,
        timestamp: timestamp
    };

    if (errorMessage.includes('Rate limit reached')) {
        statusCode = 429;
        responseBody.error = 'Rate limit reached';
        responseBody.details = 'An API rate limit has been reached. Please try again later.';
    } else if (errorMessage.includes('Timeout')) {
        statusCode = 504;
        responseBody.error = 'Timeout';
        responseBody.details = 'The request timed out. Please try again with a shorter video or increase the timeout limit.';
    } else if (errorMessage.includes('Failed to fetch transcript')) {
        statusCode = 404;
        responseBody.error = 'Transcript not found';
        responseBody.details = 'Unable to fetch the transcript for this video. It may not be available or the video might be private.';
    } else if (errorMessage.includes('Video transcript is too long')) {
        statusCode = 413;
        responseBody.error = 'Video too long';
        responseBody.details = errorMessage;
    } else if (errorMessage.includes('Invalid YouTube URL')) {
        statusCode = 400;
        responseBody.error = 'Invalid input';
        responseBody.details = 'The provided URL is not a valid YouTube URL.';
    } else if (errorMessage.includes('Could not extract video ID')) {
        statusCode = 400;
        responseBody.error = 'Invalid input';
        responseBody.details = 'Could not extract a valid video ID from the provided URL.';
    }

    if (process.env.NODE_ENV !== 'production') {
        responseBody.stack = error.stack;
        responseBody.name = error.name;
        responseBody.openAIApiKey = OPENAI_API_KEY ? 'Set' : 'Not set';
        responseBody.youtubeApiKey = YOUTUBE_API_KEY ? 'Set' : 'Not set';
    }

    res.status(statusCode).json(responseBody);
}

function recordUsage(videoId) {
    const currentCount = analyticsCache.get(videoId) || 0;
    analyticsCache.set(videoId, currentCount + 1);
}
