const { pipeline } = require('@huggingface/inference');
const fs = require('fs').promises;

async function runBenchmark() {
  const models = [
    'facebook/bart-large-cnn',
    't5-small',
    'google/pegasus-xsum'
  ];

  const testCases = [
    { name: 'Short text', text: await fs.readFile('test_short.txt', 'utf-8') },
    { name: 'Medium text', text: await fs.readFile('test_medium.txt', 'utf-8') },
    { name: 'Long text', text: await fs.readFile('test_long.txt', 'utf-8') }
  ];

  for (const model of models) {
    console.log(`Testing model: ${model}`);
    const summarizer = pipeline('summarization', { model });

    for (const testCase of testCases) {
      console.log(`  Test case: ${testCase.name}`);
      const startTime = Date.now();
      
      try {
        const result = await summarizer(testCase.text, {
          max_length: 150,
          min_length: 30,
          do_sample: false
        });
        
        const endTime = Date.now();
        console.log(`    Time taken: ${endTime - startTime}ms`);
        console.log(`    Summary length: ${result[0].summary_text.length} characters`);
        // Here you could add more sophisticated evaluation metrics
      } catch (error) {
        console.error(`    Error: ${error.message}`);
      }
    }
  }
}

runBenchmark().catch(console.error);