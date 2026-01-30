// AI-Generated Content Detection Service
// Flags potential AI-generated or manipulated content
// Based on Bellingcat's OSH framework indicators

export interface ContentCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'unknown' | 'warning';
  description: string;
}

export interface AIDetectionResult {
  isSuspicious: boolean;
  confidence: number;  // 0-100
  checks: ContentCheck[];
  verdict: 'likely_real' | 'uncertain' | 'likely_ai';
  recommendations: string[];
}

// Common AI generation artifacts to check for
export function checkAIContent(
  metadata?: {
    hasEXIF?: boolean;
    hasGPS?: boolean;
    consistentTimestamp?: boolean;
    sourceVerified?: boolean;
  },
  imageAnalysis?: {
    hasInconsistentLighting?: boolean;
    hasUnnaturalEdges?: boolean;
    hasDuplicatePatterns?: boolean;
    hasTextAnomalies?: boolean;
  }
): AIDetectionResult {
  const checks: ContentCheck[] = [
    {
      id: 'exif',
      label: 'EXIF Metadata Present',
      status: metadata?.hasEXIF ? 'pass' : metadata?.hasEXIF === false ? 'fail' : 'unknown',
      description: 'Original images have EXIF data. Missing EXIF may indicate AI generation.'
    },
    {
      id: 'gps',
      label: 'GPS Coordinates Verified',
      status: metadata?.hasGPS ? 'pass' : metadata?.hasGPS === false ? 'fail' : 'unknown',
      description: 'GPS data in photos helps verify location. Missing GPS is a warning sign.'
    },
    {
      id: 'timestamp',
      label: 'Timestamp Consistency',
      status: metadata?.consistentTimestamp ? 'pass' : metadata?.consistentTimestamp === false ? 'fail' : 'unknown',
      description: 'Check if timestamp matches event date. Inconsistent timestamps suggest manipulation.'
    },
    {
      id: 'source',
      label: 'Primary Source Verified',
      status: metadata?.sourceVerified ? 'pass' : metadata?.sourceVerified === false ? 'fail' : 'unknown',
      description: 'Always trace content to original source. Viral content without source is suspicious.'
    },
    {
      id: 'lighting',
      label: 'Lighting Consistency',
      status: imageAnalysis?.hasInconsistentLighting ? 'fail' : imageAnalysis?.hasInconsistentLighting === false ? 'pass' : 'unknown',
      description: 'AI images often have inconsistent lighting/shadows across the image.'
    },
    {
      id: 'edges',
      label: 'Edge Quality Analysis',
      status: imageAnalysis?.hasUnnaturalEdges ? 'fail' : imageAnalysis?.hasUnnaturalEdges === false ? 'pass' : 'unknown',
      description: 'AI images may have blurry or unusually sharp edges around subjects.'
    },
    {
      id: 'patterns',
      label: 'Pattern Analysis',
      status: imageAnalysis?.hasDuplicatePatterns ? 'fail' : imageAnalysis?.hasDuplicatePatterns === false ? 'pass' : 'unknown',
      description: 'AI may repeat patterns (fingers, eyes, text) inconsistently.'
    },
    {
      id: 'text',
      label: 'Text Analysis',
      status: imageAnalysis?.hasTextAnomalies ? 'fail' : imageAnalysis?.hasTextAnomalies === false ? 'pass' : 'unknown',
      description: 'AI-generated text in images often has anomalies or wrong characters.'
    },
  ];

  // Calculate score
  const completedChecks = checks.filter(c => c.status !== 'unknown');
  const passedChecks = completedChecks.filter(c => c.status === 'pass');
  const failedChecks = completedChecks.filter(c => c.status === 'fail');
  
  const score = completedChecks.length > 0 
    ? Math.round((passedChecks.length / completedChecks.length) * 100)
    : 50;  // Neutral if no checks completed

  // Determine verdict
  let verdict: AIDetectionResult['verdict'];
  if (completedChecks.length === 0) {
    verdict = 'uncertain';
  } else if (failedChecks.length >= 3 || score < 30) {
    verdict = 'likely_ai';
  } else if (passedChecks.length >= 5 && failedChecks.length === 0) {
    verdict = 'likely_real';
  } else {
    verdict = 'uncertain';
  }

  // Generate recommendations
  const recommendations: string[] = [];
  if (checks.find(c => c.id === 'source' && c.status !== 'pass')) {
    recommendations.push('🔍 Trace the content to its original source before sharing');
  }
  if (checks.find(c => c.id === 'exif' && c.status === 'fail')) {
    recommendations.push('⚠️ Missing EXIF data - verify through other means');
  }
  if (checks.find(c => c.id === 'timestamp' && c.status === 'fail')) {
    recommendations.push('⏰ Timestamp doesn\'t match event - could be old footage');
  }
  if (verdict === 'uncertain') {
    recommendations.push('📋 Manual verification needed - check multiple sources');
  }
  if (verdict === 'likely_real') {
    recommendations.push('✅ Content appears consistent - still verify key claims');
  }
  if (verdict === 'likely_ai') {
    recommendations.push('🚫 Content has AI generation indicators - do not share as authentic');
  }

  return {
    isSuspicious: verdict === 'likely_ai' || (failedChecks.length >= 2),
    confidence: score,
    checks,
    verdict,
    recommendations
  };
}

// Bellingcat's seven deadly sins of bad OSINT
export const BELLINGCAT_SINS = [
  {
    id: 'speed',
    label: 'Racing to be First',
    description: 'Validation should always take precedence over speed. Breaking news encourages being first, which leads to errors.',
    warning: 'When big news breaks, verify before sharing.'
  },
  {
    id: 'old_footage',
    label: 'Recycled/Old Footage',
    description: 'Old footage from previous events is often shared as current news.',
    warning: 'Check timestamps and reverse image search.'
  },
  {
    id: 'geolocation',
    label: 'Geolocation Errors',
    description: 'Wrong locations are commonly shared.',
    warning: 'Verify landmarks, signage, language, and infrastructure.'
  },
  {
    id: 'manipulated',
    label: 'Manipulated Images',
    description: 'AI and editing tools make manipulation easier.',
    warning: 'Look for inconsistencies in lighting, shadows, and edges.'
  },
  {
    id: 'state_actors',
    label: 'State Actor Disinformation',
    description: 'Governments may share misleading content.',
    warning: 'Be skeptical of content from conflict zones.'
  },
  {
    id: 'context',
    label: 'Missing Context',
    description: 'True events can be presented misleadingly.',
    warning: 'Establish full context before drawing conclusions.'
  },
  {
    id: 'primary_source',
    label: 'No Primary Source',
    description: 'Viral content without source is unreliable.',
    warning: 'Always try to find the original source.'
  }
];

// Quick checklist for content verification
export function getQuickVerificationChecklist(): string[] {
  return [
    '🔍 Does the content have a verifiable source?',
    '🕐 Is the timestamp consistent with the event?',
    '📍 Can the location be independently verified?',
    '🔄 Is this old footage being presented as new?',
    '🤖 Are there signs of AI generation?',
    '📰 Does it match other reports from reliable sources?',
    '⚖️ Is there political motivation to mislead?',
  ];
}
