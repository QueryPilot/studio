import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BreadcrumbNav } from '../BreadcrumbNav';
import type { PathSegment } from '../../sources/types';

describe('BreadcrumbNav', () => {
  const defaultProps = {
    path: [] as PathSegment[],
    collectionName: 'users',
    onNavigate: vi.fn(),
    onNavigateToRoot: vi.fn(),
  };

  it('should render collection name at root', () => {
    render(<BreadcrumbNav {...defaultProps} />);

    expect(screen.getByText('users')).toBeInTheDocument();
  });

  it('should render path segments', () => {
    const path: PathSegment[] = [
      { key: 'address', label: 'address', type: 'object' },
      { key: 'city', label: 'city', type: 'object' },
    ];

    render(<BreadcrumbNav {...defaultProps} path={path} />);

    expect(screen.getByText('users')).toBeInTheDocument();
    expect(screen.getByText('address')).toBeInTheDocument();
    expect(screen.getByText('city')).toBeInTheDocument();
  });

  it('should call onNavigateToRoot when root is clicked', () => {
    const onNavigateToRoot = vi.fn();
    render(<BreadcrumbNav {...defaultProps} onNavigateToRoot={onNavigateToRoot} />);

    fireEvent.click(screen.getByText('users'));

    expect(onNavigateToRoot).toHaveBeenCalledTimes(1);
  });

  it('should call onNavigate with correct index when segment is clicked', () => {
    const onNavigate = vi.fn();
    const path: PathSegment[] = [
      { key: 'address', label: 'address', type: 'object' },
      { key: 'city', label: 'city', type: 'object' },
    ];

    render(<BreadcrumbNav {...defaultProps} path={path} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('address'));

    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it('should show depth indicator when path is not empty', () => {
    const path: PathSegment[] = [
      { key: 'address', label: 'address', type: 'object' },
      { key: 'city', label: 'city', type: 'object' },
    ];

    render(<BreadcrumbNav {...defaultProps} path={path} />);

    expect(screen.getByText('Depth: 2')).toBeInTheDocument();
  });

  it('should not show depth indicator at root', () => {
    render(<BreadcrumbNav {...defaultProps} />);

    expect(screen.queryByText(/Depth:/)).not.toBeInTheDocument();
  });

  it('should highlight the current segment', () => {
    const path: PathSegment[] = [
      { key: 'address', label: 'address', type: 'object' },
    ];

    render(<BreadcrumbNav {...defaultProps} path={path} />);

    const addressButton = screen.getByText('address').closest('button');
    expect(addressButton).toHaveClass('font-medium');
  });

  it('should handle array type segments', () => {
    const path: PathSegment[] = [
      { key: 'items', label: 'items', type: 'array' },
      { key: 0, label: '[0]', type: 'object' },
    ];

    render(<BreadcrumbNav {...defaultProps} path={path} />);

    expect(screen.getByText('items')).toBeInTheDocument();
    expect(screen.getByText('[0]')).toBeInTheDocument();
  });
});
