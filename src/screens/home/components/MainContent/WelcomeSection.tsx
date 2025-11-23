export function WelcomeSection() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <h1 className="text-2xl font-semibold italic mb-2">Welcome to Query Pilot</h1>
      <p className="text-xs text-muted-foreground">
        Connect to your databases and start querying
      </p>
    </div>
  );
}
