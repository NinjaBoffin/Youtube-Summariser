const { YoutubeTranscript } = require('youtube-transcript');
const natural = require('natural');

module.exports = async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing URL parameter' });
  }

  try {
    const transcriptResult = await fetchTranscript(url);
    const summary = summariseText(transcriptResult.transcript);

    res.status(200).json({ 
      transcript: transcriptResult.transcript,
      summary: summary,
      message: transcriptResult.message
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

async function fetchTranscript(url) {
  try {
    const videoId = extractVideoId(url);
    const transcriptArray = await YoutubeTranscript.fetchTranscript(videoId);
    
    if (transcriptArray.length === 0) {
      return { 
        transcript: "No transcript available for this video.",
        message: "The video doesn't have any captions or transcript."
      };
    }

    const fullTranscript = transcriptArray.map(item => item.text).join(' ');
    return { 
      transcript: fullTranscript,
      message: "Transcript fetched successfully."
    };
  } catch (error) {
    return { 
      transcript: "Unable to fetch transcript.",
      message: `Error: ${error.message}. Please try a different video.`
    };
  }
}

function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) {
    return match[2];
  } else {
    throw new Error('Invalid YouTube URL');
  }
}

function summariseText(text) {
  // Tokenize the text into sentences
  const tokenizer = new natural.SentenceTokenizer();
  const sentences = tokenizer.tokenize(text);

  // Calculate word frequency
  const wordFreq = {};
  sentences.forEach(sentence => {
    const words = sentence.toLowerCase().split(/\s+/);
    words.forEach(word => {
      if (word.length > 3) {  // Ignore short words
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    });
  });

  // Score sentences based on word frequency
  const sentenceScores = sentences.map(sentence => {
    const words = sentence.toLowerCase().split(/\s+/);
    const score = words.reduce((total, word) => total + (wordFreq[word] || 0), 0);
    return { sentence, score };
  });

  // Sort sentences by score and select top 3 (or fewer if there are less than 3 sentences)
  const topSentences = sentenceScores
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(3, sentences.length))
    .map(item => item.sentence);

  // Join the top sentences to form the summary
  return topSentences.join(' ');
}