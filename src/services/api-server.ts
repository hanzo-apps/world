// World Monitor API Service
// Enables third-party integrations via REST API
// Supports external apps, webhooks, and data export

import express, { Request, Response, NextFunction } from 'express';

export interface APIConfig {
  port: number;
  apiKey: string;
  corsOrigins: string[];
  rateLimit: number;  // requests per minute
}

export interface APIEndpoints {
  stories: string;
  signals: string;
  reports: string;
  health: string;
  docs: string;
}

export interface ExternalAPIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// API configuration
let config: APIConfig = {
  port: 3001,
  apiKey: process.env.WORLDMONITOR_API_KEY || 'dev-key-change-in-production',
  corsOrigins: ['http://localhost:3000'],
  rateLimit: 100,
};

// Rate limiting store
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Middleware: API key validation
export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!apiKey || apiKey !== config.apiKey) {
    res.status(401).json({
      success: false,
      error: 'Invalid or missing API key',
      timestamp: new Date().toISOString(),
    } as ExternalAPIResponse<null>);
    return;
  }
  
  next();
}

// Middleware: Rate limiting
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const clientId = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 60000;  // 1 minute
  
  let clientData = rateLimitStore.get(clientId);
  
  if (!clientData || now > clientData.resetTime) {
    clientData = { count: 1, resetTime: now + windowMs };
    rateLimitStore.set(clientId, clientData);
  } else {
    clientData.count++;
  }
  
  if (clientData.count > config.rateLimit) {
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      timestamp: new Date().toISOString(),
    } as ExternalAPIResponse<null>);
    return;
  }
  
  next();
}

// Create Express app for API
export function createAPIServer(
  handlers: {
    getStories: () => Promise<any[]>;
    getSignals: () => Promise<any[]>;
    getReport: (period: string) => Promise<any>;
    getHealth: () => Promise<any>;
  }
) {
  const app = express();
  
  // Middleware
  app.use(express.json());
  app.use(rateLimitMiddleware);
  
  // CORS
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Content-Type');
    }
    next();
  });
  
  // Health check (no auth required)
  app.get('/api/health', async (req, res) => {
    try {
      const health = await handlers.getHealth();
      res.json({
        success: true,
        data: health,
        timestamp: new Date().toISOString(),
      } as ExternalAPIResponse<any>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Health check failed',
        timestamp: new Date().toISOString(),
      } as ExternalAPIResponse<null>);
    }
  });
  
  // API documentation endpoint
  app.get('/api', (req, res) => {
    res.json({
      success: true,
      data: {
        name: 'World Monitor API',
        version: '1.0.0',
        endpoints: {
          'GET /api/health': 'Health check (no auth)',
          'GET /api/stories': 'Get intelligence stories',
          'GET /api/signals': 'Get threat signals',
          'GET /api/reports/:period': 'Get reports (daily/weekly)',
          'GET /api/countries': 'Get monitored countries',
          'GET /api/categories': 'Get story categories',
        },
        authentication: {
          header: 'X-API-Key',
          query: 'api_key',
        },
        rateLimit: `${config.rateLimit} requests/minute`,
      },
      timestamp: new Date().toISOString(),
    } as ExternalAPIResponse<any>);
  });
  
  // Protected endpoints
  app.use(apiKeyMiddleware);
  
  // Get stories
  app.get('/api/stories', async (req, res) => {
    try {
      const { region, category, limit } = req.query;
      let stories = await handlers.getStories();
      
      // Filter by region
      if (region) {
        stories = stories.filter(s => 
          (s as any).region?.toLowerCase() === (region as string).toLowerCase()
        );
      }
      
      // Filter by category
      if (category) {
        stories = stories.filter(s => 
          (s as any).category?.toLowerCase() === (category as string).toLowerCase()
        );
      }
      
      // Limit results
      const maxLimit = Math.min(parseInt(limit as string) || 50, 100);
      stories = stories.slice(0, maxLimit);
      
      res.json({
        success: true,
        data: {
          stories,
          count: stories.length,
          filters: { region, category, limit: maxLimit },
        },
        timestamp: new Date().toISOString(),
      } as ExternalAPIResponse<any>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch stories',
        timestamp: new Date().toISOString(),
      } as ExternalAPIResponse<null>);
    }
  });
  
  // Get signals
  app.get('/api/signals', async (req, res) => {
    try {
      const { severity, region, limit } = req.query;
      let signals = await handlers.getSignals();
      
      // Filter by severity
      if (severity) {
        signals = signals.filter(s => 
          (s as any).severity === severity
        );
      }
      
      // Filter by region
      if (region) {
        signals = signals.filter(s => 
          (s as any).region?.toLowerCase() === (region as string).toLowerCase()
        );
      }
      
      // Limit results
      const maxLimit = Math.min(parseInt(limit as string) || 50, 100);
      signals = signals.slice(0, maxLimit);
      
      res.json({
        success: true,
        data: {
          signals,
          count: signals.length,
          filters: { severity, region, limit: maxLimit },
        },
        timestamp: new Date().toISOString(),
      } as ExternalAPIResponse<any>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch signals',
        timestamp: new Date().toISOString(),
      } as ExternalAPIResponse<null>);
    }
  });
  
  // Get reports
  app.get('/api/reports/:period', async (req, res) => {
    try {
      const { period } = req.params;
      const report = await handlers.getReport(period);
      
      res.json({
        success: true,
        data: report,
        timestamp: new Date().toISOString(),
      } as ExternalAPIResponse<any>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: `Failed to generate ${req.params.period} report`,
        timestamp: new Date().toISOString(),
      } as ExternalAPIResponse<null>);
    }
  });
  
  // Get monitored countries
  app.get('/api/countries', (req, res) => {
    res.json({
      success: true,
      data: {
        countries: [
          'United States', 'Russia', 'Ukraine', 'Iran', 'Israel',
          'China', 'Taiwan', 'North Korea', 'Turkey', 'Saudi Arabia',
        ],
      },
      timestamp: new Date().toISOString(),
    } as ExternalAPIResponse<any>);
  });
  
  // Get categories
  app.get('/api/categories', (req, res) => {
    res.json({
      success: true,
      data: {
        categories: [
          'military', 'politics', 'economy', 'technology',
          'environment', 'intelligence', 'disinformation',
        ],
      },
      timestamp: new Date().toISOString(),
    } as ExternalAPIResponse<any>);
  });
  
  return app;
}

// Webhook service for external notifications
export interface WebhookConfig {
  url: string;
  events: string[];
  secret: string;
}

export class WebhookService {
  private webhooks: Map<string, WebhookConfig> = new Map();
  
  // Register a webhook
  registerWebhook(id: string, config: WebhookConfig): boolean {
    try {
      new URL(config.url);
      this.webhooks.set(id, config);
      return true;
    } catch {
      return false;
    }
  }
  
  // Remove a webhook
  removeWebhook(id: string): boolean {
    return this.webhooks.delete(id);
  }
  
  // Trigger webhooks for an event
  async trigger(event: string, data: any): Promise<void> {
    for (const [id, config] of this.webhooks) {
      if (config.events.includes(event)) {
        this.sendWebhook(config, event, data);
      }
    }
  }
  
  private async sendWebhook(config: WebhookConfig, event: string, data: any): Promise<void> {
    try {
      const payload = {
        event,
        data,
        timestamp: new Date().toISOString(),
        signature: this.generateSignature(config.secret, JSON.stringify(payload)),
      };
      
      await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': payload.signature,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error(`Webhook ${config.url} failed:`, error);
    }
  }
  
  private generateSignature(secret: string, payload: string): string {
    // Simple HMAC signature (use crypto in production)
    const crypto = require('crypto');
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }
  
  // List registered webhooks
  listWebhooks(): { id: string; events: string[] }[] {
    return Array.from(this.webhooks).map(([id, config]) => ({
      id,
      events: config.events,
    }));
  }
}

// Export/Import service
export class DataExportService {
  // Export stories to JSON
  static exportStories(stories: any[]): string {
    return JSON.stringify({
      exportDate: new Date().toISOString(),
      count: stories.length,
      stories,
    }, null, 2);
  }
  
  // Export stories to CSV
  static exportStoriesCSV(stories: any[]): string {
    const headers = ['id', 'title', 'region', 'category', 'date', 'source'];
    const rows = stories.map(s => [
      s.id,
      `"${(s.title || '').replace(/"/g, '""')}"`,
      s.region || '',
      s.category || '',
      s.date || '',
      `"${(s.source || '').replace(/"/g, '""')}"`,
    ]);
    
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
  
  // Export signals to JSON
  static exportSignals(signals: any[]): string {
    return JSON.stringify({
      exportDate: new Date().toISOString(),
      count: signals.length,
      signals,
    }, null, 2);
  }
  
  // Export report to markdown
  static exportReport(report: any): string {
    const { reportGenerator } = require('./report-generator');
    return reportGenerator.reportToMarkdown(report);
  }
}

// Configure API
export function configureAPI(newConfig: Partial<APIConfig>): void {
  config = { ...config, ...newConfig };
}

// Get API status
export function getAPIStatus(): { configured: boolean; port: number; endpoints: string[] } {
  return {
    configured: true,
    port: config.port,
    endpoints: ['/api/health', '/api', '/api/stories', '/api/signals', '/api/reports/:period', '/api/countries', '/api/categories'],
  };
}
