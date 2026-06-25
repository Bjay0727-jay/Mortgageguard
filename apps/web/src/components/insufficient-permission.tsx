export function InsufficientPermission({ message = "Insufficient permission" }: { message?: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
      <h2 className="mb-1 text-base font-semibold">{message}</h2>
      <p>Your role does not include the capability required to access this page or action.</p>
    </div>
  );
}
