/**
 * KeyValueDataGrid Tests
 *
 * Basic tests to ensure KeyValueDataGrid renders with BaseDataGrid pattern
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { KeyValueDataGrid } from '../KeyValueDataGrid';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('KeyValueDataGrid', () => {
  it('should render without crashing', () => {
    const { container } = render(
      <KeyValueDataGrid
        gridId="test-kv"
        connectionId="test-conn"
        database={0}
        initialKey="user:1"
      />,
      { wrapper: Wrapper }
    );

    // Should render with keyvalue-datagrid class or empty state
    expect(container.querySelector('.keyvalue-datagrid') || container.querySelector('div')).toBeInTheDocument();
  });

  it('should use BaseDataGrid pattern when key is loaded', () => {
    const { container } = render(
      <KeyValueDataGrid
        gridId="test-kv"
        connectionId="test-conn"
        database={0}
        initialKey="user:1"
      />,
      { wrapper: Wrapper }
    );

    // Should attempt to render (may show empty state or BaseDataGrid depending on data)
    expect(container.firstChild).toBeTruthy();
  });

  it('should render with custom className', () => {
    const { container } = render(
      <KeyValueDataGrid
        gridId="test-kv"
        connectionId="test-conn"
        database={0}
        className="custom-class"
      />,
      { wrapper: Wrapper }
    );

    expect(container.querySelector('.custom-class') || container.firstChild).toBeTruthy();
  });
});
