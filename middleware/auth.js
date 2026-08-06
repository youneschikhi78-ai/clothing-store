function isLoggedIn(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  res.redirect('/admin/login');
}

function isGuest(req, res, next) {
  if (req.session.user) return res.redirect('/');
  next();
}

module.exports = { isLoggedIn, isAdmin, isGuest };
