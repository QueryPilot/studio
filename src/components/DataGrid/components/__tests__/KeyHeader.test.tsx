import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyHeader } from '../KeyHeader';
import type { KeyMetadata } from '../../sources/types';

describe('KeyHeader', () => {
  const defaultProps = {
    metadata: null,
    onRefresh: vi.fn(),
  };

  it('should render null when metadata is null', () => {
    const { container } = render(<KeyHeader {...defaultProps} />);

    expect(container.firstChild).toBeNull();
  });

  it('should render key name', () => {
    const metadata: KeyMetadata = {
      key: 'my:key',
      type: 'string',
      ttl: 300,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('my:key')).toBeInTheDocument();
  });

  it('should render type badges', () => {
    const metadata: KeyMetadata = {
      key: 'user:1',
      type: 'hash',
      ttl: -1,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('HASH')).toBeInTheDocument();
  });

  it('should render type badge for list', () => {
    const metadata: KeyMetadata = {
      key: 'mylist',
      type: 'list',
      ttl: 0,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('LIST')).toBeInTheDocument();
  });

  it('should render type badge for set', () => {
    const metadata: KeyMetadata = {
      key: 'myset',
      type: 'set',
      ttl: 3600,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('SET')).toBeInTheDocument();
  });

  it('should render type badge for zset', () => {
    const metadata: KeyMetadata = {
      key: 'myleaderboard',
      type: 'zset',
      ttl: -1,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('ZSET')).toBeInTheDocument();
  });

  it('should render "No expiry" for negative TTL', () => {
    const metadata: KeyMetadata = {
      key: 'persistent',
      type: 'string',
      ttl: -1,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('No expiry')).toBeInTheDocument();
  });

  it('should format TTL in seconds', () => {
    const metadata: KeyMetadata = {
      key: 'short',
      type: 'string',
      ttl: 30,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('30s')).toBeInTheDocument();
  });

  it('should format TTL in minutes', () => {
    const metadata: KeyMetadata = {
      key: 'minute',
      type: 'string',
      ttl: 300,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('5m')).toBeInTheDocument();
  });

  it('should format TTL in hours', () => {
    const metadata: KeyMetadata = {
      key: 'hour',
      type: 'string',
      ttl: 7200,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('2h')).toBeInTheDocument();
  });

  it('should format TTL in days', () => {
    const metadata: KeyMetadata = {
      key: 'day',
      type: 'string',
      ttl: 86400 * 2,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('2d')).toBeInTheDocument();
  });

  it('should render size when provided', () => {
    const metadata: KeyMetadata = {
      key: 'large',
      type: 'string',
      ttl: -1,
      size: 1024,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.getByText('1,024')).toBeInTheDocument();
    expect(screen.getByText('bytes')).toBeInTheDocument();
  });

  it('should not render size when undefined', () => {
    const metadata: KeyMetadata = {
      key: 'small',
      type: 'string',
      ttl: -1,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} />);

    expect(screen.queryByText(/bytes/)).not.toBeInTheDocument();
  });

  it('should call onRefresh when refresh button is clicked', () => {
    const onRefresh = vi.fn();
    const metadata: KeyMetadata = {
      key: 'test',
      type: 'string',
      ttl: -1,
    };

    render(<KeyHeader {...defaultProps} metadata={metadata} onRefresh={onRefresh} />);

    const refreshButton = screen.getByLabelText('Refresh key data');
    expect(refreshButton).toBeInTheDocument();

    // Add click test
    fireEvent.click(refreshButton);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
