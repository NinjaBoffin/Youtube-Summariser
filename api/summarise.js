module.exports = (req, res) => {
  try {
    const { url } = req.query;

    console.log('Function invoked with URL:', url);

    res.status(200).json({ 
      message: `Received URL: ${url}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in serverless function:', error);
    res.status(500).json({ 
      error: 'An error occurred in the serverless function',
      details: error.message
    });
  }
};