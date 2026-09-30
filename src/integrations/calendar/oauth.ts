// Harvested from Publicato-personal server/services/googleOAuthService.ts.
// Changed: only the calendar.readonly scope is kept; Drive, Ads, Analytics, Search Console
// and Business Profile scopes are removed. Config is injected (BOUWPLAN.md, 11.8).
import { OAuth2Client, type Credentials } from 'google-auth-library';

export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'] as const;

export interface GoogleOAuthConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string | undefined;
}

export interface NormalizedGoogleTokens {
  accessToken: string | null;
  refreshToken: string | null;
  scope: string[];
  expiryDate: Date | null;
}

export class GoogleCalendarOAuth {
  constructor(private readonly config: GoogleOAuthConfig) {}

  getAuthUrl(state: string): string {
    return this.createClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [...CALENDAR_SCOPES],
      include_granted_scopes: false,
      state,
    });
  }

  async exchangeCode(code: string): Promise<NormalizedGoogleTokens> {
    const { tokens } = await this.createClient().getToken(code);
    return normalizeTokens(tokens);
  }

  async refreshAccessToken(refreshToken: string): Promise<NormalizedGoogleTokens> {
    const client = this.createClient();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();
    return normalizeTokens(credentials);
  }

  async revokeToken(token: string): Promise<void> {
    await this.createClient().revokeToken(token);
  }

  private createClient(): OAuth2Client {
    const { clientId, clientSecret, redirectUri } = this.config;
    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth client credentials are not configured');
    }
    return new OAuth2Client({ clientId, clientSecret, ...(redirectUri && { redirectUri }) });
  }
}

function normalizeTokens(tokens: Credentials): NormalizedGoogleTokens {
  return {
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    scope: tokens.scope ? Array.from(new Set(tokens.scope.split(/[\s,]+/).filter(Boolean))) : [],
    expiryDate: typeof tokens.expiry_date === 'number' ? new Date(tokens.expiry_date) : null,
  };
}
