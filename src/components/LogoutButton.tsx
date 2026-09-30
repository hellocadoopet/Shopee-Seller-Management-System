
export default function LogoutButton() {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button onClick={logout} className="text-xs text-gray-500 hover:text-shopee-700">
      Log out
    </button>
  );
}
