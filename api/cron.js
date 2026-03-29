export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    message: "Daily cron route is working"
  });
}
