module.exports = async (req, res) => {
  try {
    const { url } = req.query;

    // Log the received URL
    console.log('Received URL:', url);

    if (!url) {
      return res.status(400).json({ error: 'Missing URL parameter' });
    }

    // Return a more detailed response
    res.status(200).json({ 
      receivedUrl: url,
      message: `URL successfully received`,
      timestamp: new Date().toISOString(),
      queryParams: req.query,
      headers: req.headers
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