module.exports = async (req, res) => {
  try {
    const { url } = req.query;

    console.log('Function invoked with URL:', url);

    res.status(200).json({ 
      transcript: "This is a test transcript.",
      summary: "This is a test summary.",
      message: `Received URL: ${url}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in serverless function:', error);
    res.status(500).json({ 
      error: 'An error occurred in the serverless function',
      details: error.message,
      stack: error.stack,
      name: error.name
    });
  }
};