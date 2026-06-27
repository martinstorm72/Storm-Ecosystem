(function () {
    // Lightweight realtime helper injected via config.js
    // Wait for the Supabase client library to be available, then create
    // a small client that subscribes to `operator_data` changes for the
    // signed-in user and merges updates into the page's state.
    function setup() {
        try {
            if (!window.supabase || !window.supabase.createClient) return;
            // Use __APP_CONFIG__ if the app provided explicit values
            var cfg = window.__APP_CONFIG__ || {};
            var url = cfg.SUPABASE_URL || null;
            var key = cfg.SUPABASE_KEY || null;
            // If we don't have a URL/key here, try to create a client with
            // no-op values and rely on auth events (some pages embed keys elsewhere).
            var client = null;
            try { client = window.supabase.createClient(url, key); } catch (e) {
                try { client = window.supabase.createClient(url || '', key || ''); } catch (e2) { console.warn('[config.js] supabase.createClient failed', e2); return }
            }
            if (!client) return;
            window._rt_supabase = client;

            // Helper to subscribe for a particular user id
            function subscribeForUser(userId) {
                if (!userId) return;
                try { if (window._rt_channel) { try { client.removeChannel(window._rt_channel) } catch { } window._rt_channel = null } } catch { }
                try {
                    var chan = client.channel('realtime:operator_data:' + userId);
                    chan.on('postgres_changes', { event: '*', schema: 'public', table: 'operator_data', filter: 'user_id=eq.' + userId }, function (payload) {
                        try {
                            // payload.new contains the row after change
                            var row = payload && payload.new;
                            if (!row || !row.data) return;
                            var cloud = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
                            var cloudSavedAt = row.updated_at || (cloud && cloud._savedAt) || '';
                            try {
                                // If dashboard exposes _applyCloudState and renderAll, use them
                                if (typeof window._applyCloudState === 'function') {
                                    var localSavedAt = (window.S && window.S._savedAt) || '';
                                    if (!localSavedAt || (cloudSavedAt && cloudSavedAt > localSavedAt)) {
                                        window._applyCloudState(cloud);
                                        if (typeof window.ensureArrays === 'function') window.ensureArrays();
                                        if (window.S) { window.S._savedAt = cloudSavedAt || (new Date()).toISOString(); try { localStorage.setItem((typeof window._dataKey === 'function' ? window._dataKey(userId) : 'storm_os_v5_' + userId), JSON.stringify(window.S)) } catch (e) { } }
                                        if (typeof window.renderAll === 'function') window.renderAll();
                                        if (typeof window.updateSyncStatus === 'function') window.updateSyncStatus('synced');
                                    }
                                } else {
                                    // fallback: dispatch an event the dashboard can listen for
                                    window.dispatchEvent(new CustomEvent('supabase:realtime', { detail: { row: row } }));
                                }
                            } catch (e) { console.warn('[config.js] realtime apply failed', e) }
                        } catch (e) { console.warn('[config.js] realtime payload error', e) }
                    }).subscribe(function (status) {
                        console.log('[config.js] realtime channel status', status);
                    });
                    window._rt_channel = chan;
                } catch (e) { console.warn('[config.js] realtime subscribe error', e) }
            }

            // Listen for auth changes to know the signed-in user id
            try {
                client.auth.onAuthStateChange(function (event, session) {
                    var user = session && session.user;
                    if (user && user.id) subscribeForUser(user.id);
                    if (event === 'SIGNED_OUT') {
                        try { if (window._rt_channel) { client.removeChannel(window._rt_channel); window._rt_channel = null } } catch (e) { }
                    }
                });
            } catch (e) { console.warn('[config.js] auth listener failed', e) }

            // If a session already exists, subscribe now
            try {
                client.auth.getSession().then(function (res) {
                    var user = res && res.data && res.data.session && res.data.session.user;
                    if (user && user.id) subscribeForUser(user.id);
                }).catch(function () { });
            } catch (e) { }
        } catch (e) { console.warn('[config.js] setup failed', e) }
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(setup, 50); else document.addEventListener('DOMContentLoaded', setup);
})();
