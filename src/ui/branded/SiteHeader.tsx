import { useEffect, useState } from 'react';
import {  Button  } from '@hanzo/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hanzo/ui/dropdown-menu';
import { Moon, Sun, Menu as MenuIcon, LogOut, Settings, User } from 'lucide-react';
import { useTheme } from 'next-themes';
import { HanzoLogo } from './HanzoLogo';
import { signInWithIam, signOut, getCurrentSession, type IamSession } from '../lib/iam-auth';
import { cn } from '../lib/cn';

const NAV_LINKS = [
  { label: 'Overview', href: '/' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Docs', href: 'https://docs.hanzo.ai', external: true },
  { label: 'Blog', href: '/blog/' },
  { label: 'Status', href: 'https://status.hanzo.ai', external: true },
];

const SOCIAL_LINKS = [
  { label: 'GitHub', href: 'https://github.com/hanzoai/world' },
  { label: 'Discord', href: 'https://discord.gg/hanzo' },
];

export interface SiteHeaderProps {
  /** Callback to open the AccountSettings sheet. */
  onOpenSettings?: () => void;
}

export function SiteHeader({ onOpenSettings }: SiteHeaderProps) {
  const [session, setSession] = useState<IamSession | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    setSession(getCurrentSession());
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const isDark = (resolvedTheme ?? theme) === 'dark';

  return (
    <header
      className={cn(
        'hanzo-site-header hanzo-chrome font-inter sticky top-0 z-40 w-full transition-colors',
        'border-b',
        scrolled ? 'bg-background/90 backdrop-blur-md border-border' : 'bg-background/60 border-transparent',
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <a href="/" className="shrink-0" aria-label="Hanzo World home">
          <HanzoLogo />
        </a>

        <nav className="hidden md:flex items-center gap-5 text-sm">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="hidden lg:flex items-center gap-3 text-sm">
          {SOCIAL_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <Button
          variant="ghost"
          size="icon"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          className="text-muted-foreground hover:text-foreground"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {session ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-foreground"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
                  {(session.name ?? session.email ?? 'U').slice(0, 1).toUpperCase()}
                </div>
                <span className="hidden sm:inline max-w-[120px] truncate">
                  {session.name ?? session.email}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{session.name ?? 'Account'}</span>
                  {session.email && (
                    <span className="text-xs text-muted-foreground truncate">{session.email}</span>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onOpenSettings?.()} className="gap-2">
                <Settings className="h-4 w-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/pricing" className="gap-2">
                  <User className="h-4 w-4" /> Billing
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => signOut()} className="gap-2 text-destructive-foreground">
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            size="sm"
            onClick={() => signInWithIam()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Sign in
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          aria-label="Menu"
          className="md:hidden text-muted-foreground"
          onClick={() => onOpenSettings?.()}
        >
          <MenuIcon className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
