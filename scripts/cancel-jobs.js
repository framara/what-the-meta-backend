const axios = require('axios');

// Cancel jobs via Render API
async function cancelJobs() {
  const serviceId = ''; // Render service ID
  const apiKey = ''; // Render API key
  
  console.log('🔍 Checking for running jobs...\n');
  
  try {
    // First, list all jobs
    const jobsResponse = await axios.get(`https://api.render.com/v1/services/${serviceId}/jobs`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    const jobs = jobsResponse.data;
    console.log(`Found ${jobs.length} jobs:`);
    
    // Extract job objects from the response structure
    const jobList = jobs.map(item => item.job).filter(Boolean);
    
    jobList.forEach((job, index) => {
      console.log(`${index + 1}. Job ID: ${job.id}`);
      console.log(`   Status: ${job.status}`);
      console.log(`   Created: ${job.createdAt}`);
      console.log(`   Command: ${job.startCommand}`);
      if (job.finishedAt) {
        console.log(`   Finished: ${job.finishedAt}`);
      }
      console.log('');
    });
    
    // Find running jobs
    const runningJobs = jobList.filter(job => 
      job.status === 'running' || job.status === 'pending'
    );
    
    if (runningJobs.length === 0) {
      console.log('✅ No running jobs found.');
      return;
    }
    
    console.log(`Found ${runningJobs.length} running job(s):`);
    
    // Cancel each running job using POST method
    for (const job of runningJobs) {
      console.log(`Cancelling job ${job.id}...`);
      
      try {
        const cancelResponse = await axios.post(`https://api.render.com/v1/services/${serviceId}/jobs/${job.id}/cancel`, {}, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        console.log(`✅ Successfully cancelled job ${job.id}`);
      } catch (error) {
        console.log(`❌ Failed to cancel job ${job.id}:`, error.response?.status, error.response?.data?.message || error.response?.data);
      }
    }
    
  } catch (error) {
    console.log('❌ Error:', error.response?.status, error.response?.data);
  }
}

// Cancel specific job by ID
async function cancelSpecificJob(jobId) {
  const serviceId = 'srv-d21n8j6mcj7s73epb570';
  const apiKey = 'rnd_5QypY8Is9KY3RS20twBK2jqUTMjr';
  
  console.log(`🚫 Cancelling job ${jobId}...`);
  
  try {
    const response = await axios.post(`https://api.render.com/v1/services/${serviceId}/jobs/${jobId}/cancel`, {}, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Successfully cancelled job ${jobId}`);
  } catch (error) {
    console.log(`❌ Failed to cancel job ${jobId}:`, error.response?.status, error.response?.data?.message || error.response?.data);
  }
}

// Check command line arguments
const args = process.argv.slice(2);

if (args.length > 0) {
  // Cancel specific job
  const jobId = args[0];
  cancelSpecificJob(jobId);
} else {
  // Cancel all running jobs
  cancelJobs();
} 