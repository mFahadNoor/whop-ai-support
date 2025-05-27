import { NextRequest, NextResponse } from 'next/server';
import { healthChecker } from '@/lib/health-check';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    // Get the latest health status
    const health = await healthChecker.checkHealth();
    
    // Return appropriate HTTP status code based on health
    const statusCode = health.healthy ? 200 : 503; // Service Unavailable if unhealthy
    
    logger.info('Health check requested', {
      healthy: health.healthy,
      userAgent: request.headers.get('user-agent'),
      action: 'health_check_api',
    });
    
    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    logger.error('Health check API error', error, {
      action: 'health_check_api_error',
    });
    
    return NextResponse.json(
      {
        healthy: false,
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Simple readiness check for Kubernetes/Docker
export async function HEAD(request: NextRequest) {
  try {
    const lastCheck = healthChecker.getLastCheck();
    
    // If we have a recent health check (within 10 minutes) and it's healthy, return 200
    if (lastCheck && lastCheck.healthy) {
      const checkAge = Date.now() - new Date(lastCheck.timestamp).getTime();
      const maxAge = 10 * 60 * 1000; // 10 minutes
      
      if (checkAge < maxAge) {
        return new NextResponse(null, { status: 200 });
      }
    }
    
    // Otherwise perform a quick health check
    const health = await healthChecker.checkHealth();
    return new NextResponse(null, { status: health.healthy ? 200 : 503 });
  } catch (error) {
    logger.error('Health check HEAD error', error, {
      action: 'health_check_head_error',
    });
    
    return new NextResponse(null, { status: 503 });
  }
} 