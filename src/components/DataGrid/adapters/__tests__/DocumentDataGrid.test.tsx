/**
 * DocumentDataGrid Tests
 *
 * Basic tests to ensure DocumentDataGrid renders with BaseDataGrid pattern
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DocumentDataGrid } from '../DocumentDataGrid';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('DocumentDataGrid', () => {
  it('should render without crashing', () => {
    const { container } = render(
      <DocumentDataGrid
        gridId="test-doc"
        connectionId="test-conn"
        database="test-db"
        collection="users"
      />,
      { wrapper: Wrapper }
    );

    // Should render with document-datagrid class
    expect(container.querySelector('.document-datagrid')).toBeInTheDocument();
  });

  it('should use BaseDataGrid pattern', () => {
    const { container } = render(
      <DocumentDataGrid
        gridId="test-doc"
        connectionId="test-conn"
        database="test-db"
        collection="users"
      />,
      { wrapper: Wrapper }
    );

    // Should render BaseDataGrid
    expect(container.querySelector('[data-testid="base-datagrid"]')).toBeInTheDocument();
  });

  it('should render with custom className', () => {
    const { container } = render(
      <DocumentDataGrid
        gridId="test-doc"
        connectionId="test-conn"
        database="test-db"
        collection="users"
        className="custom-class"
      />,
      { wrapper: Wrapper }
    );

    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });
});
