
export default function LogoutButton() {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button onClick={logout} className="text-xs text-gray-400 hover:text-shopee">
      Log out
    </button>
  );
}
