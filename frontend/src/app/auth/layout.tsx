// Layout for /auth/* pages (verify-email, reset-password)
// Uses the same centered card design as the (auth) route group.
// This is a real directory (not a route group) because the auth service
// sends email links to /auth/verify-email and /auth/reset-password.
export default function AuthSubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-500 rounded-xl mb-3">
            <svg viewBox="0 0 24 24" fill="white" className="w-7 h-7">
              <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm14 2a4 4 0 110 8 4 4 0 010-8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">FlowForge</h1>
          <p className="text-sm text-gray-500 mt-1">Project management for modern teams</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
