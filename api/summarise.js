module.exports = async (req, res) => {
  try {
    const { url } = req.query;

    console.log('Received URL:', url);

    if (!url) {
      return res.status(400).json({ error: 'Missing URL parameter' });
    }

    // Return a response that matches what the frontend expects
    res.status(200).json({ 
      transcript: `This is a placeholder transcript for the video at ${url}`,
      summary: `This is a placeholder summary for the video at ${url}`,
      message: `URL successfully received: ${url}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in serverless function:', error);
    res.status(500).json({ 
      error: 'An error occurred in the serverless function',
      details: error.message,
      stack: error.stack
    });
  }
};