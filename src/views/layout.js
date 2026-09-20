export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function layout({ title, body, admin = false, posthog, bare = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Triage Prototype</title>
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?f[]=clash-display@500,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
${posthog?.key ? `<script>
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init(${JSON.stringify(posthog.key)},{api_host:${JSON.stringify(posthog.host)},person_profiles:'identified_only'});
</script>` : ''}
</head>
<body class="${admin ? 'admin' : 'public'}">
<header class="topbar">
  <a class="wordmark" href="/">Triage Prototype</a>
  <nav>
    ${bare
      ? `<a class="btn btn-ghost" href="/">Public chat</a>`
      : admin
      ? `<a href="/admin">Conversations</a><a href="/admin/kb">Knowledge base</a><a href="/admin/metrics">Metrics</a><a href="/admin/eval">Eval</a><a class="btn btn-ghost" href="/">Public chat</a><form method="post" action="/admin/logout" class="inline-form"><button class="btn btn-ghost btn-sm" style="padding:6px 12px">Sign out</button></form>`
      : `<a href="#how">How it works</a><a href="https://github.com/cyrilgaillard/triage-prototype" rel="noopener">Repo</a><a class="btn btn-ghost" href="/admin">Admin</a>`}
  </nav>
</header>
<main class="page">${body}</main>
<footer class="foot">
  <p>Prototype built for a job application. Not affiliated with any healthcare provider. Answers are drawn from publicly published pages, conversations are synthetic, and nothing here is medical advice.</p>
</footer>
</body>
</html>`;
}
