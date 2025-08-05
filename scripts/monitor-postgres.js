#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class PostgresMonitor {
  constructor(containerName = 'postgres') {
    this.containerName = containerName;
  }

  async getContainerStats() {
    try {
      const { stdout } = await execAsync(`docker stats ${this.containerName} --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}"`);
      return stdout;
    } catch (error) {
      console.error('Error getting container stats:', error.message);
      return null;
    }
  }

  async getContainerInfo() {
    try {
      const { stdout } = await execAsync(`docker inspect ${this.containerName}`);
      return JSON.parse(stdout)[0];
    } catch (error) {
      console.error('Error getting container info:', error.message);
      return null;
    }
  }

  async getPostgresProcesses() {
    try {
      const { stdout } = await execAsync(`docker exec ${this.containerName} ps aux | grep postgres`);
      return stdout;
    } catch (error) {
      console.error('Error getting PostgreSQL processes:', error.message);
      return null;
    }
  }

  async getPostgresLogs(lines = 50) {
    try {
      const { stdout } = await execAsync(`docker logs ${this.containerName} --tail ${lines}`);
      return stdout;
    } catch (error) {
      console.error('Error getting PostgreSQL logs:', error.message);
      return null;
    }
  }

  async checkDiskUsage() {
    try {
      const { stdout } = await execAsync(`docker exec ${this.containerName} df -h`);
      return stdout;
    } catch (error) {
      console.error('Error checking disk usage:', error.message);
      return null;
    }
  }

  async checkMemoryUsage() {
    try {
      const { stdout } = await execAsync(`docker exec ${this.containerName} free -h`);
      return stdout;
    } catch (error) {
      console.error('Error checking memory usage:', error.message);
      return null;
    }
  }

  async monitorPerformance(duration = 300) { // 5 minutes default
    console.log(`\n🔍 Monitoring PostgreSQL container '${this.containerName}' for ${duration} seconds...\n`);
    
    const startTime = Date.now();
    const interval = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      
      console.log(`\n⏱️  Time elapsed: ${elapsed}s`);
      console.log('='.repeat(50));
      
      // Get container stats
      const stats = await this.getContainerStats();
      if (stats) {
        console.log('📊 Container Stats:');
        console.log(stats);
      }
      
      // Get memory usage inside container
      const memory = await this.checkMemoryUsage();
      if (memory) {
        console.log('\n💾 Memory Usage:');
        console.log(memory);
      }
      
      // Get disk usage
      const disk = await this.checkDiskUsage();
      if (disk) {
        console.log('\n💿 Disk Usage:');
        console.log(disk);
      }
      
      if (elapsed >= duration) {
        clearInterval(interval);
        console.log('\n✅ Monitoring completed!');
      }
    }, 10000); // Check every 10 seconds
  }

  async runQuickDiagnostic() {
    console.log('\n🔍 Quick PostgreSQL Diagnostic\n');
    console.log('='.repeat(50));
    
    // Container stats
    console.log('📊 Container Stats:');
    const stats = await this.getContainerStats();
    if (stats) console.log(stats);
    
    // Container info
    console.log('\n📋 Container Info:');
    const info = await this.getContainerInfo();
    if (info) {
      console.log(`Name: ${info.Name}`);
      console.log(`Image: ${info.Config.Image}`);
      console.log(`Status: ${info.State.Status}`);
      console.log(`Created: ${info.Created}`);
      console.log(`Memory Limit: ${info.HostConfig.Memory || 'No limit'}`);
      console.log(`CPU Limit: ${info.HostConfig.CpuQuota || 'No limit'}`);
    }
    
    // Memory usage
    console.log('\n💾 Memory Usage:');
    const memory = await this.checkMemoryUsage();
    if (memory) console.log(memory);
    
    // Disk usage
    console.log('\n💿 Disk Usage:');
    const disk = await this.checkDiskUsage();
    if (disk) console.log(disk);
    
    // Recent logs
    console.log('\n📝 Recent Logs (last 20 lines):');
    const logs = await this.getPostgresLogs(20);
    if (logs) console.log(logs);
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const monitor = new PostgresMonitor();
  
  if (args.includes('--monitor') || args.includes('-m')) {
    const duration = parseInt(args.find(arg => arg.startsWith('--duration='))?.split('=')[1]) || 300;
    await monitor.monitorPerformance(duration);
  } else {
    await monitor.runQuickDiagnostic();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = PostgresMonitor; 