import Link from "next/link";

export default function Navigation() {
  return (
    <nav className="bg-black border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="text-xl font-bold text-white hover:text-zinc-300 transition-colors duration-200 flex items-center">
              <span className="mr-2">🤖</span>
              Custom Command Bot
            </Link>
          </div>
          <div className="flex items-center space-x-4">
            <Link
              href="/commands"
              className="bg-white text-black hover:bg-zinc-200 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 transform hover:scale-105 flex items-center"
            >
              <span className="mr-2">⚙️</span>
              Manage Commands
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
} 