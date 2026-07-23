/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 01-boot.js
 * lines: 1-4959 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        const APP_BUILD = '20260704c';
        console.log('=== 年年有喜管理系统启动 ===');

        // 登录页按租户展示自定义系统名称/页面标题/logo——平台管理后台设置的profile.system_name/
        // logo_url此前只存进数据库，没有任何前端真正读取展示；这里在登录前就拉一次公开只读接口应用。
        function resolveHrmsLoginTenantId() {
            try {
                const params = new URLSearchParams(location.search);
                const fromUrl = String(params.get('tenant_id') || '').trim();
                if (fromUrl) {
                    try { localStorage.setItem('hrms_tenant_id', fromUrl); } catch (e) {}
                    return fromUrl;
                }
                const stored = String(localStorage.getItem('hrms_tenant_id') || '').trim();
                if (stored && stored !== 'default') {
                    try {
                        params.set('tenant_id', stored);
                        const qs = params.toString();
                        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
                    } catch (e) {}
                    return stored;
                }
                return 'default';
            } catch (e) {
                return 'default';
            }
        }

        (function applyTenantBranding() {
            try {
                const tenantId = resolveHrmsLoginTenantId();
                fetch(`/api/tenant/branding?tenant_id=${encodeURIComponent(tenantId)}`)
                    .then((r) => r.json())
                    .then((data) => {
                        if (!data) return;
                        if (data.system_name) {
                            document.title = data.system_name;
                            try { sessionStorage.setItem('hrms_brand_name', data.system_name); } catch (e) {}
                            const titleEl = document.getElementById('login-tenant-title');
                            if (titleEl) {
                                titleEl.textContent = data.system_name;
                                titleEl.style.visibility = 'visible';
                            }
                        }
                        if (data.logo_url) {
                            const logoEl = document.getElementById('login-tenant-logo');
                            if (logoEl) { logoEl.src = data.logo_url; logoEl.style.display = ''; }
                        }
                        if (data.favicon_url) {
                            let link = document.querySelector('link[rel="icon"]');
                            if (!link) {
                                link = document.createElement('link');
                                link.rel = 'icon';
                                document.head.appendChild(link);
                            }
                            link.href = data.favicon_url;
                        }
                        if (data.brand_color) {
                            try {
                                document.documentElement.style.setProperty('--hrms-brand-color', data.brand_color);
                                document.documentElement.style.setProperty('--hrms-brand', data.brand_color);
                            } catch (e) {}
                        }
                    })
                    .catch(() => {});
            } catch (e) {}
        })();

        let isLoggedIn = false;
        let currentPage = 'profile';
        let currentUser = null;

        // 角色定义
        const ROLES = {
            ADMIN: 'admin',
            HQ_MANAGER: 'hq_manager',
            STORE_MANAGER: 'store_manager',
            FRONT_MANAGER: 'front_manager',
            FRONT_SUPERVISOR: 'front_supervisor',
            CASHIER: 'cashier',
            HR_MANAGER: 'hr_manager',
            PRODUCTION_MANAGER: 'store_production_manager',
            EMPLOYEE: 'store_employee'
        };

        function hrmsNormalizeRoleCode(input) {
            const v = String(input || '').trim();
            if (!v) return ROLES.EMPLOYEE;
            if (v === 'hq_employee') return ROLES.HR_MANAGER;
            if (Object.values(ROLES).includes(v)) return v;
            const map = {
                '管理员': ROLES.ADMIN,
                '系统管理员': ROLES.ADMIN,
                'custom_管理员': ROLES.ADMIN,
                'custom_系统管理员': ROLES.ADMIN,
                '总部经理': ROLES.HQ_MANAGER,
                '总部营运': ROLES.HQ_MANAGER,
                'custom_总部经理': ROLES.HQ_MANAGER,
                'custom_总部营运': ROLES.HQ_MANAGER,
                'custom_总部管理层': ROLES.HQ_MANAGER,
                '总部人员': ROLES.HR_MANAGER,
                '总部人事': ROLES.HR_MANAGER,
                '人事经理': ROLES.HR_MANAGER,
                'custom_总部人员': ROLES.HR_MANAGER,
                'custom_总部人事': ROLES.HR_MANAGER,
                'custom_人事经理': ROLES.HR_MANAGER,
                '出纳': ROLES.CASHIER,
                '总部出纳': ROLES.CASHIER,
                'custom_出纳': ROLES.CASHIER,
                '门店店长': ROLES.STORE_MANAGER,
                '店长': ROLES.STORE_MANAGER,
                'custom_门店店长': ROLES.STORE_MANAGER,
                'custom_店长': ROLES.STORE_MANAGER,
                '门店出品经理': ROLES.PRODUCTION_MANAGER,
                '出品经理': ROLES.PRODUCTION_MANAGER,
                'custom_门店出品经理': ROLES.PRODUCTION_MANAGER,
                'custom_出品经理': ROLES.PRODUCTION_MANAGER,
                // Historical typo/legacy code used in older data, keep compatible.
                'store_product_manager': ROLES.PRODUCTION_MANAGER,
                '门店员工': ROLES.EMPLOYEE,
                '员工': ROLES.EMPLOYEE
            };
            if (map[v]) return map[v];
            if (v.startsWith('custom_')) {
                const raw = v.slice(7);
                if (map[raw]) return map[raw];
                if (/管理员/.test(raw)) return ROLES.ADMIN;
                if (/总部|营运/.test(raw)) return ROLES.HQ_MANAGER;
                if (/人事|HR/i.test(raw)) return ROLES.HR_MANAGER;
                if (/店长/.test(raw)) return ROLES.STORE_MANAGER;
                if (/出品/.test(raw)) return ROLES.PRODUCTION_MANAGER;
                if (/出纳|财务/.test(raw)) return ROLES.CASHIER;
                return ROLES.EMPLOYEE;
            }
            if (!Object.values(ROLES).includes(v)) return ROLES.EMPLOYEE;
            return v;
        }

        function hrmsNormalizeStatusCode(input) {
            const v = String(input || '').trim();
            if (!v) return 'active';
            const lower = v.toLowerCase();
            if (['active', 'enabled', 'enable', 'on', '1'].includes(lower)) return 'active';
            if (['disabled', 'inactive', 'disable', 'off', '0'].includes(lower)) return 'disabled';
            if (['启用', '正常', '在职'].includes(v)) return 'active';
            if (['禁用', '停用', '离职'].includes(v)) return 'disabled';
            return lower === 'active' || lower === 'disabled' ? lower : 'active';
        }

        function hrmsMigrateUsersIntoEmployeesOnce() {
            const flagKey = 'hrms_migrated_users_to_employees_v1';
            if (localStorage.getItem(flagKey) === '1') return;

            const users = HRMS_STORE.getUsers();
            const employees = HRMS_STORE.getEmployees();
            const byUsername = new Map((employees || []).map(e => [String(e?.username || '').trim(), e]));
            let changed = false;

            (users || []).forEach(u => {
                const username = String(u?.username || '').trim();
                if (!username) return;
                const role = hrmsNormalizeRoleCode(u.role);
                const merged = {
                    id: String(u.id || '') || '',
                    username,
                    name: String(u.name || ''),
                    role,
                    store: String(u.store || ''),
                    managerUsername: String(u.managerUsername || ''),
                    position: String(u.position || ''),
                    department: String(u.department || ''),
                    level: String(u.level || ''),
                    salary: u.salary ?? '',
                    joinDate: String(u.joinDate || ''),
                    phone: String(u.phone || ''),
                    email: String(u.email || ''),
                    status: String(u.status || 'active'),
                    createdAt: String(u.createdAt || ''),
                    lastLogin: u.lastLogin || null
                };

                const existing = byUsername.get(username);
                if (existing) byUsername.set(username, { ...existing, ...merged, id: existing.id || merged.id });
                else byUsername.set(username, merged);
                changed = true;
            });

            (employees || []).forEach(e => {
                const username = String(e?.username || '').trim();
                if (!username) return;
                const normalized = hrmsNormalizeRoleCode(e.role);
                if (String(e.role || '') !== normalized) {
                    byUsername.set(username, { ...e, role: normalized });
                    changed = true;
                }
            });

            if (changed) {
                const list = Array.from(byUsername.values()).filter(e => String(e?.username || '').trim());
                list.forEach(e => { if (!e.id) e.id = hrmsGenerateEmployeeId(); });
                HRMS_STORE.setEmployees(list);
            }
            localStorage.setItem(flagKey, '1');
        }
        
        // 权限定义
        const PERMISSIONS = {
            VIEW_OWN_INFO: 'view_own_info',
            VIEW_STORE_INFO: 'view_store_info',
            VIEW_ALL_INFO: 'view_all_info',
            EDIT_CONTENT: 'edit_content',
            DELETE_CONTENT: 'delete_content',
            UPLOAD_CONTENT: 'upload_content',
            ASSIGN_TASKS: 'assign_tasks',
            MANAGE_REWARDS: 'manage_rewards',
            BATCH_OPERATIONS: 'batch_operations'
        };

        const PERMISSION_LABELS = {
            [PERMISSIONS.VIEW_OWN_INFO]: '查看本人信息',
            [PERMISSIONS.VIEW_STORE_INFO]: '查看本门店信息',
            [PERMISSIONS.VIEW_ALL_INFO]: '查看全局信息',
            [PERMISSIONS.EDIT_CONTENT]: '编辑内容/配置',
            [PERMISSIONS.DELETE_CONTENT]: '删除内容',
            [PERMISSIONS.UPLOAD_CONTENT]: '上传内容',
            [PERMISSIONS.ASSIGN_TASKS]: '安排培训/考试',
            [PERMISSIONS.MANAGE_REWARDS]: '管理奖惩',
            [PERMISSIONS.BATCH_OPERATIONS]: '批量操作'
        };

        function formatPermissionLabel(code) {
            const key = String(code || '').trim();
            return PERMISSION_LABELS[key] || key;
        }
        
        // 角色权限映射
        const ROLE_PERMISSIONS = {
            [ROLES.ADMIN]: [
                PERMISSIONS.VIEW_OWN_INFO,
                PERMISSIONS.VIEW_STORE_INFO,
                PERMISSIONS.VIEW_ALL_INFO,
                PERMISSIONS.EDIT_CONTENT,
                PERMISSIONS.DELETE_CONTENT,
                PERMISSIONS.UPLOAD_CONTENT,
                PERMISSIONS.ASSIGN_TASKS,
                PERMISSIONS.MANAGE_REWARDS,
                PERMISSIONS.BATCH_OPERATIONS
            ],
            [ROLES.HQ_MANAGER]: [
                PERMISSIONS.VIEW_OWN_INFO,
                PERMISSIONS.VIEW_STORE_INFO,
                PERMISSIONS.VIEW_ALL_INFO,
                PERMISSIONS.EDIT_CONTENT,
                PERMISSIONS.UPLOAD_CONTENT,
                PERMISSIONS.ASSIGN_TASKS,
                PERMISSIONS.MANAGE_REWARDS
            ],
            [ROLES.HR_MANAGER]: [
                PERMISSIONS.VIEW_OWN_INFO,
                PERMISSIONS.VIEW_ALL_INFO,
                PERMISSIONS.MANAGE_REWARDS,
                PERMISSIONS.ASSIGN_TASKS
            ],
            [ROLES.CASHIER]: [
                PERMISSIONS.VIEW_OWN_INFO
            ],
            [ROLES.STORE_MANAGER]: [
                PERMISSIONS.VIEW_OWN_INFO,
                PERMISSIONS.VIEW_STORE_INFO,
                PERMISSIONS.ASSIGN_TASKS,
                PERMISSIONS.MANAGE_REWARDS
            ],
            [ROLES.PRODUCTION_MANAGER]: [
                PERMISSIONS.VIEW_OWN_INFO,
                PERMISSIONS.VIEW_STORE_INFO
            ],
            [ROLES.EMPLOYEE]: [
                PERMISSIONS.VIEW_OWN_INFO
            ]
        };

        const HRMS_SCHEMA_VERSION = 1;
        const HRMS_STORAGE_KEY = 'hrms_data_v' + HRMS_SCHEMA_VERSION;
        const HRMS_LS_CLEANUP_ONCE_KEY = 'HRMS_LS_CLEANUP_V2_20260426';

        function hrmsCleanupOversizedLocalStorageOnce() {
            try {
                if (localStorage.getItem(HRMS_LS_CLEANUP_ONCE_KEY) === '1') return;
                const keys = [];
                for (let i = 0; i < localStorage.length; i += 1) {
                    const k = localStorage.key(i);
                    if (k) keys.push(String(k));
                }

                for (const key of keys) {
                    if (!key) continue;
                    const raw = localStorage.getItem(key);
                    const size = raw ? raw.length : 0;
                    if (!size) continue;

                    if (key.startsWith('hrms_data') && key !== HRMS_STORAGE_KEY) {
                        localStorage.removeItem(key);
                        continue;
                    }

                    if (/^HRMS_KB_FLASHCARDS_/.test(key)) {
                        localStorage.removeItem(key);
                        continue;
                    }

                    if (/^HRMS_KB_FILTERS_/.test(key) && size > 200000) {
                        localStorage.removeItem(key);
                        continue;
                    }

                    if (key !== HRMS_STORAGE_KEY) continue;
                    if (size < 1500000) continue;
                    const parsed = hrmsSafeParseJson(raw);
                    if (!parsed || typeof parsed !== 'object') continue;

                    if (Array.isArray(parsed.knowledge)) parsed.knowledge = [];
                    if (Array.isArray(parsed.trainingMaterials)) parsed.trainingMaterials = [];
                    if (Array.isArray(parsed.questionBank)) parsed.questionBank = [];
                    localStorage.setItem(HRMS_STORAGE_KEY, JSON.stringify(parsed));
                }

                localStorage.setItem(HRMS_LS_CLEANUP_ONCE_KEY, '1');
            } catch (e) {}
        }

        hrmsCleanupOversizedLocalStorageOnce();

        function hrmsTryLoadLegacyStoreData() {
            try {
                const candidates = [];
                for (let i = 0; i < localStorage.length; i += 1) {
                    const k = localStorage.key(i);
                    if (!k) continue;
                    if (k === HRMS_STORAGE_KEY) continue;
                    if (!String(k).startsWith('hrms_data')) continue;
                    const raw = localStorage.getItem(k);
                    if (!raw) continue;
                    const parsed = hrmsSafeParseJson(raw);
                    if (!parsed || parsed.schemaVersion !== HRMS_SCHEMA_VERSION) continue;
                    const ts = Date.parse(parsed.exportedAt || parsed.updatedAt || parsed.createdAt || '') || 0;
                    candidates.push({ key: k, ts, data: parsed });
                }
                if (!candidates.length) return null;
                candidates.sort((a, b) => (b.ts || 0) - (a.ts || 0));
                return candidates[0].data || null;
            } catch (e) {
                return null;
            }
        }

        function hrmsMergeLegacyIntoCurrentIfNeeded(current, legacy) {
            try {
                if (!current || !legacy) return current;
                const out = { ...current };
                const mergeList = (a, b, keyFn) => {
                    const arrA = Array.isArray(a) ? a : [];
                    const arrB = Array.isArray(b) ? b : [];
                    if (!arrB.length) return arrA;
                    const used = new Set(arrA.map(x => keyFn(x)).filter(Boolean));
                    const merged = arrA.slice();
                    for (const item of arrB) {
                        const k = keyFn(item);
                        if (k && used.has(k)) continue;
                        merged.push(item);
                        if (k) used.add(k);
                    }
                    return merged;
                };
                const curRes = Array.isArray(out.examResults) ? out.examResults : [];
                const legRes = Array.isArray(legacy.examResults) ? legacy.examResults : [];
                if (!curRes.length && legRes.length) out.examResults = legRes;
                else out.examResults = mergeList(curRes, legRes, (x) => String(x?.id || ''));

                const curAsg = Array.isArray(out.examAssignments) ? out.examAssignments : [];
                const legAsg = Array.isArray(legacy.examAssignments) ? legacy.examAssignments : [];
                if (!curAsg.length && legAsg.length) out.examAssignments = legAsg;
                else out.examAssignments = mergeList(curAsg, legAsg, (x) => String(x?.id || ''));

                return out;
            } catch (e) {
                return current;
            }
        }

        function hrmsNowISO() {
            return new Date().toISOString();
        }

        function hrmsSyncSegmentWithSelect(segId, selectId, disabled) {
            const seg = document.getElementById(segId);
            const sel = document.getElementById(selectId);
            if (!seg || !sel) return;

            const btns = seg.querySelectorAll('.ui-seg-btn');
            const currentVal = sel.value;

            btns.forEach(btn => {
                const val = btn.dataset.value;
                btn.classList.toggle('active', val === currentVal);
                btn.disabled = !!disabled;
                btn.onclick = disabled ? null : () => {
                    sel.value = val;
                    btns.forEach(b => b.classList.toggle('active', b.dataset.value === val));
                };
            });
        }

        function hrmsFormatLocalDateTime(input) {
            try {
                if (!input) return '';
                const d = (typeof input === 'number')
                    ? new Date(input)
                    : new Date(String(input));
                if (!d || Number.isNaN(d.getTime())) return String(input || '');
                const pad = (n) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            } catch (e) {
                return String(input || '');
            }
        }

        function hrmsSafeParseJson(text) {
            try {
                return JSON.parse(text);
            } catch (e) {
                return null;
            }
        }

        const HRMS_LEGACY_TEST_USERNAMES = new Set(['store_emp1', 'store_prod1', 'store_mgr1', 'hq_mgr1', 'emp1']);
        const HRMS_LEGACY_TEST_EMP_IDS = new Set(['EMP001', 'EMP004']);

        function hrmsPurgeLegacyBuiltIns(input) {
            const data = input && typeof input === 'object' ? input : {};
            const users = Array.isArray(data.users) ? data.users : [];
            const employees = Array.isArray(data.employees) ? data.employees : [];
            const isLegacyUsername = (u) => HRMS_LEGACY_TEST_USERNAMES.has(String(u || '').trim().toLowerCase());

            data.users = users.filter(u => !isLegacyUsername(u?.username));
            data.employees = employees.filter(e => {
                if (isLegacyUsername(e?.username)) return false;
                const id = String(e?.id || '').trim().toUpperCase();
                return !HRMS_LEGACY_TEST_EMP_IDS.has(id);
            });
            return data;
        }

        function hrmsGetDefaultData() {
            return {
                schemaVersion: HRMS_SCHEMA_VERSION,
                exportedAt: hrmsNowISO(),
                users: [
                    {
                        id: 'emp001',
                        username: 'store_emp1',
                        name: '张三',
                        role: ROLES.EMPLOYEE,
                        store: '北京朝阳门店',
                        position: '销售员',
                        level: 'L1',
                        salary: 8000,
                        joinDate: '2023-01-15',
                        email: 'zhangsan@store.com',
                        phone: '13800138001',
                        department: '销售部',
                        managerUsername: 'store_mgr1',
                        status: 'active',
                        createdAt: '2023-01-15',
                        lastLogin: null
                    },
                    {
                        id: 'prod001',
                        username: 'store_prod1',
                        name: '赵六',
                        role: ROLES.PRODUCTION_MANAGER,
                        store: '北京朝阳门店',
                        position: '出品经理',
                        level: 'P1',
                        salary: 12000,
                        joinDate: '2022-10-10',
                        email: 'zhaoliu@store.com',
                        phone: '13800138004',
                        department: '后厨出品',
                        managerUsername: 'store_mgr1',
                        status: 'active',
                        createdAt: '2022-10-10',
                        lastLogin: null
                    },
                    {
                        id: 'mgr001',
                        username: 'store_mgr1',
                        name: '李四',
                        role: ROLES.STORE_MANAGER,
                        store: '北京朝阳门店',
                        position: '门店店长',
                        level: 'M1',
                        salary: 15000,
                        joinDate: '2022-06-01',
                        email: 'lisi@store.com',
                        phone: '13800138002',
                        department: '管理部',
                        managerUsername: 'hq_mgr1',
                        status: 'active',
                        createdAt: '2022-06-01',
                        lastLogin: null
                    },
                    {
                        id: 'hq001',
                        username: 'hq_mgr1',
                        name: '王五',
                        role: ROLES.HQ_MANAGER,
                        store: '总部',
                        position: '区域经理',
                        level: 'H1',
                        salary: 25000,
                        joinDate: '2021-03-20',
                        email: 'wangwu@hq.com',
                        phone: '13800138003',
                        department: '总部管理',
                        managerUsername: 'admin',
                        status: 'active',
                        createdAt: '2021-03-20',
                        lastLogin: null
                    },
                    {
                        id: 'admin001',
                        username: 'admin',
                        name: '系统管理员',
                        role: ROLES.ADMIN,
                        store: '总部',
                        position: '系统管理员',
                        level: 'A1',
                        salary: 30000,
                        joinDate: '2020-01-01',
                        email: 'admin@system.com',
                        phone: '13800138000',
                        department: 'IT部',
                        managerUsername: '',
                        status: 'active',
                        createdAt: '2020-01-01',
                        lastLogin: null
                    }
                ],
                employees: [
                    {
                        id: 'EMP001',
                        name: '张三',
                        store: '北京朝阳门店',
                        department: '销售部',
                        position: '销售员',
                        role: '门店员工',
                        status: 'active'
                    },
                    {
                        id: 'EMP004',
                        name: '赵六',
                        store: '北京朝阳门店',
                        department: '后厨出品',
                        position: '出品经理',
                        role: '门店出品经理',
                        status: 'active'
                    },
                    {
                        id: 'EMP002',
                        name: '李四',
                        store: '北京朝阳门店',
                        department: '管理部',
                        position: '门店店长',
                        role: '门店店长',
                        status: 'active'
                    },
                    {
                        id: 'EMP003',
                        name: '王五',
                        store: '上海徐汇门店',
                        department: '销售部',
                        position: '销售员',
                        role: '门店员工',
                        status: 'active'
                    }
                ],
                stores: [
                    { id: 'BJ001', name: '北京朝阳门店', address: '北京市朝阳区建国路88号', manager: '李四', phone: '', status: 'active' },
                    { id: 'SH001', name: '上海徐汇门店', address: '上海市徐汇区淮海路168号', manager: '钱七', phone: '', status: 'active' },
                    { id: 'SZ001', name: '深圳南山门店', address: '深圳市南山区科技园路99号', manager: '赵八', phone: '', status: 'active' }
                ],
                roles: [
                    { id: ROLES.ADMIN, name: '管理员', permissions: ROLE_PERMISSIONS[ROLES.ADMIN] || [] },
                    { id: ROLES.HQ_MANAGER, name: '总部管理层', permissions: ROLE_PERMISSIONS[ROLES.HQ_MANAGER] || [] },
                    { id: ROLES.STORE_MANAGER, name: '门店店长', permissions: ROLE_PERMISSIONS[ROLES.STORE_MANAGER] || [] },
                    { id: ROLES.PRODUCTION_MANAGER, name: '门店出品经理', permissions: ROLE_PERMISSIONS[ROLES.PRODUCTION_MANAGER] || [] },
                    { id: ROLES.EMPLOYEE, name: '门店员工', permissions: ROLE_PERMISSIONS[ROLES.EMPLOYEE] || [] }
                ],
                knowledge: [],
                trainingMaterials: [],
                questionBank: [],
                exams: [],
                examAssignments: [],
                examResults: [],
                rewardPunishments: [],
                promotionRequests: [],
                trainingTasks: [],
                announcements: [
                    {
                        id: 'ANN' + Date.now(),
                        title: '测试',
                        level: 'important',
                        content: '这是一个测试公告，希望大家都能看到',
                        scope: { type: 'all' },
                        createdAt: hrmsNowISO(),
                        createdBy: 'admin'
                    }
                ],
                notifications: [],
                settings: {
                    systemName: 'HR管理系统',
                    companyName: '示例公司',
                    examConfig: {
                        questionType: 'mix',
                        difficulty: 'medium',
                        count: 8,
                        durationMinutes: 20
                    },
                    llm: {
                        baseUrl: '',
                        model: '',
                        apiKey: ''
                    }
                }
            };
        }

        let _hrmsServerPassthrough = {};
        const HRMS_STORE = {
            get() {
                const raw = localStorage.getItem(HRMS_STORAGE_KEY);
                if (!raw) return null;
                const parsed = hrmsSafeParseJson(raw);
                if (!parsed || parsed.schemaVersion !== HRMS_SCHEMA_VERSION) return null;
                return parsed;
            },
            set(data) {
                const _slim = Object.assign({}, data);
                ['dailyReports', 'inventoryForecastHistory', 'pointRecords', 'notifications'].forEach(function(k) { delete _slim[k]; });
                // 商业化安全：本地缓存不得持久化密码字段
                if (Array.isArray(_slim.users)) {
                    _slim.users = _slim.users.map(function(u) {
                        if (!u || typeof u !== 'object') return u;
                        const next = Object.assign({}, u);
                        delete next.password;
                        delete next._loginPassword;
                        return next;
                    });
                }
                if (Array.isArray(_slim.employees)) {
                    _slim.employees = _slim.employees.map(function(e) {
                        if (!e || typeof e !== 'object') return e;
                        const next = Object.assign({}, e);
                        delete next.password;
                        delete next._loginPassword;
                        return next;
                    });
                }
                localStorage.setItem(HRMS_STORAGE_KEY, JSON.stringify(_slim));
                try {
                    hrmsScheduleStateSave();
                } catch (e) {}
            },
            ensure() {
                const existing = this.get();
                if (existing) {
                    let changed = false;
                    existing.users = Array.isArray(existing.users) ? existing.users : [];
                    existing.roles = Array.isArray(existing.roles) ? existing.roles : [];

                    const roleAliasMap = {
                        '门店员工': ROLES.EMPLOYEE,
                        '门店出品经理': ROLES.PRODUCTION_MANAGER,
                        '门店店长': ROLES.STORE_MANAGER,
                        '总部管理层': ROLES.HQ_MANAGER,
                        '管理员': ROLES.ADMIN
                    };

                    // Normalize legacy role strings (Chinese) to internal role ids
                    existing.users = existing.users.map(u => {
                        if (!u) return u;
                        const role = u.role;
                        if (typeof role === 'string' && roleAliasMap[role]) {
                            changed = true;
                            return { ...u, role: roleAliasMap[role] };
                        }
                        return u;
                    });

                    // Backfill managerUsername defaults if missing
                    existing.users = existing.users.map(u => {
                        if (Object.prototype.hasOwnProperty.call(u, 'managerUsername')) return u;
                        changed = true;

                        // heuristics by role
                        if (u.role === ROLES.ADMIN) return { ...u, managerUsername: '' };
                        if (u.role === ROLES.HQ_MANAGER) return { ...u, managerUsername: 'admin' };
                        if (u.role === ROLES.STORE_MANAGER) return { ...u, managerUsername: '' };
                        if (u.role === ROLES.PRODUCTION_MANAGER) return { ...u, managerUsername: '' };
                        if (u.role === ROLES.EMPLOYEE) return { ...u, managerUsername: '' };
                        return { ...u, managerUsername: '' };
                    });

                    const beforeUsers = existing.users.length;
                    const beforeEmployees = Array.isArray(existing.employees) ? existing.employees.length : 0;
                    hrmsPurgeLegacyBuiltIns(existing);
                    if (existing.users.length !== beforeUsers || ((Array.isArray(existing.employees) ? existing.employees.length : 0) !== beforeEmployees)) {
                        changed = true;
                    }

                    // Backfill new role in roles list
                    if (!existing.roles.some(r => r && r.id === ROLES.PRODUCTION_MANAGER)) {
                        existing.roles.push({
                            id: ROLES.PRODUCTION_MANAGER,
                            name: '门店出品经理',
                            permissions: ROLE_PERMISSIONS[ROLES.PRODUCTION_MANAGER] || []
                        });
                        changed = true;
                    }

                    // Merge legacy exam data if present (users may have historical data under old keys)
                    try {
                        const legacy = hrmsTryLoadLegacyStoreData();
                        if (legacy) {
                            const merged = hrmsMergeLegacyIntoCurrentIfNeeded(existing, legacy);
                            if (merged && merged !== existing) {
                                // merged returns a new object; keep normalization changes by overwriting
                                Object.assign(existing, merged);
                                changed = true;
                            }
                        }
                    } catch (e) {}

                    if (changed) this.set(existing);
                    return existing;
                }

                try {
                    const legacy = hrmsTryLoadLegacyStoreData();
                    if (legacy) {
                        const merged = hrmsMergeLegacyIntoCurrentIfNeeded({ ...legacy }, legacy);
                        this.set(merged);
                        return merged;
                    }
                } catch (e) {}

                const seed = hrmsGetDefaultData();
                hrmsPurgeLegacyBuiltIns(seed);
                this.set(seed);
                return seed;
            },
            updateSettings(patch) {
                const data = this.ensure();
                data.settings = { ...(data.settings || {}), ...(patch || {}) };
                this.set(data);
            },
            getSettings() {
                return this.ensure().settings || {};
            },
            getUsers() {
                return this.ensure().users || [];
            },
            setUsers(users) {
                const data = this.ensure();
                data.users = users;
                this.set(data);
            },
            getEmployees() {
                return this.ensure().employees || [];
            },
            setEmployees(employees) {
                const data = this.ensure();
                data.employees = employees;
                this.set(data);
            },

            getStores() {
                return this.ensure().stores || [];
            },
            setStores(stores) {
                const data = this.ensure();
                data.stores = stores;
                this.set(data);
            },
            getRoles() {
                return this.ensure().roles || [];
            },
            setRoles(roles) {
                const data = this.ensure();
                data.roles = roles;
                this.set(data);
            },
            getTrainingMaterials() {
                return this.ensure().trainingMaterials || [];
            },
            setTrainingMaterials(trainingMaterials) {
                const data = this.ensure();
                data.trainingMaterials = trainingMaterials;
                this.set(data);
            },
            getQuestionBank() {
                return this.ensure().questionBank || [];
            },
            setQuestionBank(questionBank) {
                const data = this.ensure();
                data.questionBank = questionBank;
                this.set(data);
            },
            getExamAssignments() {
                return this.ensure().examAssignments || [];
            },
            setExamAssignments(examAssignments) {
                const data = this.ensure();
                data.examAssignments = examAssignments;
                this.set(data);
            },
            getResignations() {
                return this.ensure().resignations || [];
            },
            setResignations(resignations) {
                const data = this.ensure();
                data.resignations = resignations;
                this.set(data);
            },
            getNotifications() {
                return this.ensure().notifications || [];
            },
            setNotifications(notifications) {
                const data = this.ensure();
                data.notifications = notifications;
                this.set(data);
            },
            getAIConfig() {
                return this.ensure().aiConfig || {};
            },
            setAIConfig(config) {
                const data = this.ensure();
                data.aiConfig = config;
                this.set(data);
            },
            getExamResults() {
                return this.ensure().examResults || [];
            },
            setExamResults(examResults) {
                const data = this.ensure();
                data.examResults = examResults;
                this.set(data);
            },
            getPromotionRequests() {
                return this.ensure().promotionRequests || [];
            },
            setPromotionRequests(promotionRequests) {
                const data = this.ensure();
                data.promotionRequests = promotionRequests;
                this.set(data);
            },
            getTrainingTasks() {
                return this.ensure().trainingTasks || [];
            },
            setTrainingTasks(trainingTasks) {
                const data = this.ensure();
                data.trainingTasks = trainingTasks;
                this.set(data);
            },
            getKnowledge() {
                if (Array.isArray(window.__HRMS_KNOWLEDGE_CACHE)) return window.__HRMS_KNOWLEDGE_CACHE;
                return this.ensure().knowledge || [];
            },
            setKnowledge(knowledge) {
                const next = Array.isArray(knowledge) ? knowledge : [];
                window.__HRMS_KNOWLEDGE_CACHE = next;
                // Avoid localStorage quota overflow: knowledge list is server source of truth.
                // Keep runtime cache only; do not persist full list into HRMS_STATE blob.
            },
            getSettings() {
                return this.ensure().settings || {};
            },
            setSettings(settings) {
                const data = this.ensure();
                data.settings = settings;
                this.set(data);
            }
        };

        const HRMS_API = {
            baseUrl() {
                const v = String(window.__HRMS_API_BASE_URL || localStorage.getItem('HRMS_API_BASE_URL') || '').trim();
                if (v) {
                    try {
                        const loc = String(window.location?.origin || '').trim();
                        const u = new URL(v, loc || undefined);
                        const port = String(u.port || '').trim();
                        const locPort = String(window.location?.port || '').trim();
                        // 生产由 Nginx 同源 /api 反代到 127.0.0.1:3000；误存直连 :3000/:3100/:3101 会 404/502
                        const badApiPorts = new Set(['3000', '3100', '3101']);
                        if (badApiPorts.has(port) && port !== locPort) {
                            try { if (loc) localStorage.setItem('HRMS_API_BASE_URL', loc); } catch (e) {}
                            return loc;
                        }
                        if (loc && u.origin !== loc && locPort !== '3000') {
                            try { if (loc) localStorage.setItem('HRMS_API_BASE_URL', loc); } catch (e) {}
                            return loc;
                        }
                        // If a stale baseUrl accidentally contains a path (e.g. http://host/hr-management-system),
                        // always normalize to origin so API paths don't 404.
                        if (loc && u.origin === loc) {
                            const pn = String(u.pathname || '').trim();
                            if (pn && pn !== '/' && pn !== '.') {
                                try { if (loc) localStorage.setItem('HRMS_API_BASE_URL', loc); } catch (e) {}
                                return loc;
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                    return v;
                }
                try {
                    const o = String(window.location?.origin || '').trim();
                    if (o && o !== 'null') return o;
                } catch (e) {}
                return '';
            },
            token() {
                return String(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '').trim();
            },
            setToken(token) {
                const t = String(token || '');
                localStorage.setItem('HRMS_API_TOKEN', t);
                localStorage.setItem('hrms_token', t);
                try {
                    const v = String(localStorage.getItem('HRMS_API_BASE_URL') || '').trim();
                    if (!v) return;
                    const loc = String(window.location?.origin || '').trim();
                    if (!loc) return;
                    const u = new URL(v, loc);
                    const port = String(u.port || '').trim();
                    const locPort = String(window.location?.port || '').trim();
                    if (new Set(['3000', '3100', '3101']).has(port) && port !== locPort) {
                        localStorage.removeItem('HRMS_API_BASE_URL');
                    }
                } catch (e) { /* ignore */ }
            },
            clearToken() {
                localStorage.removeItem('HRMS_API_TOKEN');
                localStorage.removeItem('hrms_token');
            },
            async request(path, options) {
                const opts = options || {};
                const skipAuth = !!opts.skipAuth;
                let rel = String(path || '');
                const token = skipAuth ? '' : this.token();
                try {
                    const isFd = typeof FormData !== 'undefined' && opts.body instanceof FormData;
                    if (token && isFd && !/(?:[?&])(?:access_token|token)=/.test(rel)) {
                        rel += (rel.indexOf('?') >= 0 ? '&' : '?') + 'access_token=' + encodeURIComponent(token);
                    }
                } catch (e) { /* ignore */ }
                const url = (this.baseUrl() || '') + rel;
                const headers = { ...(opts.headers || {}) };
                if (token) headers['Authorization'] = 'Bearer ' + token;
                const { skipAuth: _hrmsSkipAuth, ...fetchOpts } = opts;
                const resp = await fetch(url, { ...fetchOpts, headers });
                const text = await resp.text();
                const data = hrmsSafeParseJson(text) || { raw: text };
                if (!resp.ok) {
                    if (resp.status === 401 && String(data?.error || '') === 'session_replaced') {
                        if (!window.__HRMS_SESSION_REPLACED_SHOWN) {
                            window.__HRMS_SESSION_REPLACED_SHOWN = true;
                            try {
                                HRMS_API.clearToken();
                                isLoggedIn = false;
                                currentUser = null;
                                const loginEl = document.getElementById('login');
                                const mainEl = document.getElementById('main-app');
                                if (loginEl) loginEl.classList.remove('hidden');
                                if (mainEl) mainEl.classList.add('hidden');
                                showNotification('您的账号已在其他设备登录，请重新输入密码', 'warning');
                            } catch (e) {}
                        }
                        const err = new Error('session_replaced');
                        err.status = 401;
                        err.data = data;
                        throw err;
                    }
                    let msg = String(data?.message || data?.error || resp.statusText || '请求失败');
                    try {
                        const raw = String(text || '').trim();
                        if (resp.status === 404 && raw === 'Not Found') {
                            msg = `404 Not Found：${url}`;
                        } else {
                            msg = `${resp.status} ${msg}`;
                        }
                    } catch (e) {}
                    const err = new Error(msg);
                    err.status = resp.status;
                    err.url = url;
                    err.data = data;
                    try {
                        err.raw = text;
                    } catch (e) {}
                    try {
                        console.error('HRMS_API.request failed:', {
                            url,
                            status: resp.status,
                            statusText: resp.statusText,
                            raw: String(text || '').slice(0, 500)
                        });
                    } catch (e) {}
                    throw err;
                }
                return data;
            },
            async login(username, password) {
                const tenant_id = resolveHrmsLoginTenantId();
                const data = await this.request('/api/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Tenant-Id': tenant_id
                    },
                    body: JSON.stringify({ username, password, tenant_id }),
                    skipAuth: true
                });
                try {
                    const t = String(data?.token || '').trim();
                    if (t) this.setToken(t);
                } catch (e) {}
                return data;
            },
            async changePassword(oldPassword, newPassword) {
                return this.request('/api/auth/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPassword, newPassword })
                });
            },
            async switchStore(store) {
                return this.request('/api/auth/switch-store', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ store })
                });
            },
            async listStoreDutyBindings() {
                return this.request('/api/admin/store-duty-bindings', { method: 'GET' });
            },
            async saveStoreDutyBinding(payload) {
                return this.request('/api/admin/store-duty-bindings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async deleteStoreDutyBinding(id) {
                return this.request('/api/admin/store-duty-bindings/' + encodeURIComponent(String(id || '')), {
                    method: 'DELETE'
                });
            },
            async getStores() {
                return this.request('/api/stores', { method: 'GET' });
            },
            async createStore(payload) {
                return this.request('/api/stores', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async updateStore(id, payload) {
                return this.request('/api/stores/' + encodeURIComponent(String(id || '')), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async getBrands() {
                return this.request('/api/brands', { method: 'GET' });
            },
            async createBrand(payload) {
                return this.request('/api/brands', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async updateBrand(id, payload) {
                return this.request('/api/brands/' + encodeURIComponent(String(id || '')), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async getKnowledge(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.brandId) q.set('brandId', String(p.brandId));
                const qs = q.toString();
                return this.request('/api/knowledge' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async deleteKnowledge(id) {
                return this.request('/api/knowledge/' + encodeURIComponent(String(id || '')), { method: 'DELETE' });
            },
            async updateKnowledge(id, payload) {
                return this.request('/api/knowledge/' + encodeURIComponent(String(id || '')), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async batchUploadKnowledge(formData) {
                const rel = '/api/knowledge/batch';
                const token = this.token();
                let url = (this.baseUrl() || '') + rel;
                try {
                    if (token && !/(?:[?&])(?:access_token|token)=/.test(url)) {
                        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'access_token=' + encodeURIComponent(token);
                    }
                } catch (e) {}
                return await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    window.__KB_UPLOAD_XHR = xhr;
                    xhr.open('POST', url, true);
                    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
                    xhr.timeout = 10 * 60 * 1000;

                    const statusEl = document.getElementById('knowledge-upload-file-status');
                    xhr.upload.onprogress = (ev) => {
                        if (!statusEl) return;
                        if (!ev || !ev.lengthComputable || !ev.total) {
                            statusEl.textContent = '批量上传中...';
                            return;
                        }
                        const pct = Math.max(0, Math.min(100, Math.floor((ev.loaded / ev.total) * 100)));
                        const msg = pct >= 100
                            ? '文件已上传，服务器写入中...'
                            : `批量上传中... ${pct}%（${formatFileSize(ev.loaded)}/${formatFileSize(ev.total)}）`;
                        renderKnowledgeUploadProgress(pct, msg);
                    };

                    xhr.onerror = () => reject(new Error('上传失败（网络错误）'));
                    xhr.ontimeout = () => reject(new Error('上传超时，请稍后重试'));
                    xhr.onload = () => {
                        const text = String(xhr.responseText || '');
                        let data = {};
                        try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
                        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
                        const err = new Error(String(data?.message || data?.error || ('HTTP ' + xhr.status)));
                        err.status = xhr.status;
                        err.data = data;
                        return reject(err);
                    };
                    xhr.onloadend = () => {
                        try { if (window.__KB_UPLOAD_XHR === xhr) window.__KB_UPLOAD_XHR = null; } catch (e) {}
                    };
                    try {
                        xhr.send(formData);
                    } catch (e) {
                        reject(e);
                    }
                });
            },
            async uploadKnowledge(formData) {
                let rel = '/api/knowledge';
                const token = this.token();
                try {
                    if (token && !/(?:[?&])(?:access_token|token)=/.test(rel)) {
                        rel += (rel.indexOf('?') >= 0 ? '&' : '?') + 'access_token=' + encodeURIComponent(token);
                    }
                } catch (e) { /* ignore */ }
                const url = (this.baseUrl() || '') + rel;

                return await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    window.__KB_UPLOAD_XHR = xhr;
                    xhr.open('POST', url, true);
                    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);

                    xhr.timeout = 60 * 60 * 1000;

                    let uploadedAt = 0;
                    let warningShown = false;
                    const watchdogId = setInterval(() => {
                        try {
                            if (!window.__KB_UPLOAD_IN_PROGRESS) return;
                            if (!uploadedAt) return;
                            const elapsed = Date.now() - uploadedAt;
                            const statusEl = document.getElementById('knowledge-upload-file-status');
                            // 30秒后显示处理中提示
                            if (elapsed >= 30 * 1000 && elapsed < 120 * 1000) {
                                if (statusEl) statusEl.textContent = '服务器处理中，请耐心等待...';
                            }
                            // 2分钟后显示警告但不中断
                            if (elapsed >= 120 * 1000 && !warningShown) {
                                warningShown = true;
                                if (statusEl) statusEl.textContent = '处理时间较长，请继续等待或稍后检查知识库...';
                                showNotification('处理时间较长，文件可能已上传成功，请稍后检查知识库', 'info');
                            }
                        } catch (e) {}
                    }, 2000);

                    const statusEl = document.getElementById('knowledge-upload-file-status');
                    xhr.upload.onprogress = (ev) => {
                        if (!statusEl) return;
                        if (!ev || !ev.lengthComputable) {
                            statusEl.textContent = '上传中...';
                            return;
                        }
                        const pct = Math.max(0, Math.min(100, Math.floor((ev.loaded / ev.total) * 100)));
                        if (pct >= 100) {
                            if (!uploadedAt) uploadedAt = Date.now();
                            statusEl.textContent = '上传完成，写入中...';
                        } else {
                            statusEl.textContent = `上传中... ${pct}%（${formatFileSize(ev.loaded)}/${formatFileSize(ev.total)}）`;
                        }
                    };

                    xhr.onerror = () => reject(new Error('上传失败（网络错误）'));
                    xhr.ontimeout = () => reject(new Error('上传超时，请检查网络或稍后重试'));
                    xhr.onload = () => {
                        try { clearInterval(watchdogId); } catch (e) {}
                        const text = String(xhr.responseText || '');
                        const data = hrmsSafeParseJson(text) || { raw: text };
                        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
                        if (xhr.status === 401 && String(data?.error || '') === 'session_replaced') {
                            if (!window.__HRMS_SESSION_REPLACED_SHOWN) {
                                window.__HRMS_SESSION_REPLACED_SHOWN = true;
                                try {
                                    HRMS_API.clearToken(); isLoggedIn = false; currentUser = null;
                                    const loginEl = document.getElementById('login');
                                    const mainEl = document.getElementById('main-app');
                                    if (loginEl) loginEl.classList.remove('hidden');
                                    if (mainEl) mainEl.classList.add('hidden');
                                    showNotification('您的账号已在其他设备登录，请重新输入密码', 'warning');
                                } catch (e) {}
                            }
                            const err = new Error('session_replaced');
                            err.status = 401;
                            err.data = data;
                            return reject(err);
                        }
                        const msg = String(data?.message || data?.error || ('HTTP ' + xhr.status));
                        const err = new Error(msg);
                        err.status = xhr.status;
                        err.data = data;
                        return reject(err);
                    };

                    xhr.onloadend = () => {
                        try { clearInterval(watchdogId); } catch (e) {}
                        try { if (window.__KB_UPLOAD_XHR === xhr) window.__KB_UPLOAD_XHR = null; } catch (e) {}
                    };

                    try {
                        xhr.send(formData);
                    } catch (e) {
                        reject(e);
                    }
                });
            },

            async getExamResults(limit) {
                const q = (limit == null) ? '' : ('?limit=' + encodeURIComponent(String(limit)));
                return this.request('/api/exam-results' + q, { method: 'GET' });
            },

            async getDailyReports(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.date) q.set('date', String(p.date));
                if (p.start) q.set('start', String(p.start));
                if (p.end) q.set('end', String(p.end));
                if (p.store) q.set('store', String(p.store));
                if (p.limit != null) q.set('limit', String(p.limit));
                const qs = q.toString();
                return this.request('/api/daily-reports' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async saveDailyReport(payload) {
                const body = payload && typeof payload === 'object' ? payload : {};
                return this.request('/api/daily-reports', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            },

            async deleteDailyReport(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.store) q.set('store', String(p.store));
                if (p.date) q.set('date', String(p.date));
                const qs = q.toString();
                return this.request('/api/daily-reports' + (qs ? ('?' + qs) : ''), { method: 'DELETE' });
            },

            async getBusinessReport(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.start) q.set('start', String(p.start));
                if (p.end) q.set('end', String(p.end));
                if (p.store) q.set('store', String(p.store));
                const qs = q.toString();
                return this.request('/api/reports/business' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async getAttendanceReport(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.start) q.set('start', String(p.start));
                if (p.end) q.set('end', String(p.end));
                if (p.store) q.set('store', String(p.store));
                const qs = q.toString();
                return this.request('/api/reports/attendance' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async getDailyAttendanceRegisterReport(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.start) q.set('start', String(p.start));
                if (p.end) q.set('end', String(p.end));
                if (p.store) q.set('store', String(p.store));
                if (p.employee) q.set('employee', String(p.employee));
                const qs = q.toString();
                return this.request('/api/reports/daily-attendance-register' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async getPayrollReport(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.month) q.set('month', String(p.month));
                if (p.store) q.set('store', String(p.store));
                const qs = q.toString();
                return this.request('/api/reports/payroll' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async getTurnoverReport(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.month) q.set('month', String(p.month));
                if (p.store) q.set('store', String(p.store));
                const qs = q.toString();
                return this.request('/api/reports/turnover' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async getInventoryForecastHistory(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.store) q.set('store', String(p.store));
                if (p.brandId) q.set('brandId', String(p.brandId));
                if (p.bizType) q.set('bizType', String(p.bizType));
                if (p.slot) q.set('slot', String(p.slot));
                if (p.start) q.set('start', String(p.start));
                if (p.end) q.set('end', String(p.end));
                if (p.limit != null) q.set('limit', String(p.limit));
                const qs = q.toString();
                return this.request('/api/reports/inventory-forecast/history' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async getInventoryForecastAccuracy(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.store) q.set('store', String(p.store));
                if (p.brandId) q.set('brandId', String(p.brandId));
                if (p.bizType) q.set('bizType', String(p.bizType));
                if (p.slot) q.set('slot', String(p.slot));
                if (p.start) q.set('start', String(p.start));
                if (p.end) q.set('end', String(p.end));
                if (p.limit != null) q.set('limit', String(p.limit));
                const qs = q.toString();
                return this.request('/api/reports/inventory-forecast/accuracy' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async saveInventoryForecastHistoryBatch(payload) {
                return this.request('/api/reports/inventory-forecast/history/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },

            async uploadInventoryForecastHistoryFile(formData) {
                return this.request('/api/reports/inventory-forecast/history/upload-file', {
                    method: 'POST',
                    body: formData
                });
            },

            async predictInventoryForecast(payload) {
                return this.request('/api/reports/inventory-forecast/predict', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },

            async estimateInventoryRevenue(payload) {
                return this.request('/api/reports/inventory-forecast/revenue-estimate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },

            async getForecastGrossProfitProfiles(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.store) q.set('store', String(p.store));
                if (p.brandId) q.set('brandId', String(p.brandId));
                if (p.bizType) q.set('bizType', String(p.bizType));
                const qs = q.toString();
                return this.request('/api/reports/inventory-forecast/gross-profit-profiles' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async getForecastProductAliases(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.store) q.set('store', String(p.store));
                if (p.brandId) q.set('brandId', String(p.brandId));
                const qs = q.toString();
                return this.request('/api/reports/inventory-forecast/product-aliases' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async createForecastProductAlias(payload) {
                return this.request('/api/reports/inventory-forecast/product-aliases', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },

            async deleteForecastProductAlias(id) {
                return this.request('/api/reports/inventory-forecast/product-aliases/' + encodeURIComponent(String(id || '')),
                    { method: 'DELETE' }
                );
            },

            async saveForecastGrossProfitProfiles(payload) {
                return this.request('/api/reports/inventory-forecast/gross-profit-profiles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },

            async estimateForecastGrossMargin(payload) {
                return this.request('/api/reports/inventory-forecast/gross-margin-estimate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },

            async getPromotionRecordsReport(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.month) q.set('month', String(p.month));
                if (p.store) q.set('store', String(p.store));
                if (p.limit) q.set('limit', String(p.limit));
                const qs = q.toString();
                return this.request('/api/reports/promotion-records' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async setPayrollAudit(payload) {
                const body = payload && typeof payload === 'object' ? payload : {};
                return this.request('/api/reports/payroll/audit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            },

            async setPayrollAdjustment(payload) {
                const body = payload && typeof payload === 'object' ? payload : {};
                return this.request('/api/reports/payroll/adjustment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            },

            async getSalaryChangesReport(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.username) q.set('username', String(p.username));
                if (p.store) q.set('store', String(p.store));
                if (p.month) q.set('month', String(p.month));
                if (p.limit) q.set('limit', String(p.limit));
                const qs = q.toString();
                return this.request('/api/reports/salary-changes' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },

            async uploadDailyReportPhotos(formData) {
                return this.request('/api/uploads/daily-report', {
                    method: 'POST',
                    body: formData
                });
            },

            async saveExamResult(payload) {
                return this.request('/api/exam-results', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },

            async presignKnowledgeUpload(payload) {
                return this.request('/api/knowledge/presign', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },

            async createKnowledgeDirect(payload) {
                return this.request('/api/knowledge/direct', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },

            async getKnowledgeGroups() {
                return this.request('/api/knowledge/groups', { method: 'GET' });
            },

            async getKnowledgeGroupFiles(groupId) {
                return this.request('/api/knowledge/group/' + encodeURIComponent(String(groupId || '')), { method: 'GET' });
            },

            async updateKnowledgeGroup(groupId, payload) {
                return this.request('/api/knowledge/group/' + encodeURIComponent(String(groupId || '')), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },

            async deleteKnowledgeGroup(groupId) {
                return this.request('/api/knowledge/group/' + encodeURIComponent(String(groupId || '')), { method: 'DELETE' });
            },

            async updateKnowledgeExplanation(id, explanation) {
                return this.request('/api/knowledge/' + encodeURIComponent(String(id || '')) + '/explanation', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ explanation })
                });
            },

            async reformatKnowledgeExplanation(id) {
                return this.request('/api/knowledge/' + encodeURIComponent(String(id || '')) + '/explanation/reformat', {
                    method: 'POST'
                });
            },

            async moveKnowledgeToGroup(id, groupId) {
                return this.request('/api/knowledge/' + encodeURIComponent(String(id || '')) + '/group', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupId })
                });
            },

            async getState() {
                return this.request('/api/state', { method: 'GET' });
            },

            /** 系统管理员从服务端 hrms_state 拉取某账号当前明文密码（与改密写入 state 一致） */
            async getAdminEmployeePassword(username) {
                const u = encodeURIComponent(String(username || '').trim());
                return this.request('/api/admin/employee-password/' + u, { method: 'GET' });
            },

            async saveState(data) {
                const _d = Object.assign({}, data || {});
                ['dailyReports', 'inventoryForecastHistory', 'pointRecords'].forEach(function(k) {
                    if (_d[k] === undefined && _hrmsServerPassthrough[k] !== undefined) _d[k] = _hrmsServerPassthrough[k];
                });
                // A1/A2/A3：表权威或死字段禁止经 PUT /api/state 覆盖
                ['employees', 'roleModules', 'approvalFlows', 'paymentFlowByStore',
                 'pointRules', 'forecastCoreProducts', 'forecastProductAliasRules', 'forecastGrossProfitProfiles',
                 'knowledge', 'examResults', 'notifications',
                 'exams', 'promotionRequests', 'promotionAbilityRequirements', 'rewardPunishments'
                ].forEach(function(k) { try { delete _d[k]; } catch (e) {} });
                return this.request('/api/state', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: _d })
                });
            },

            async getApprovalFlows() {
                return this.request('/api/approval-flows', { method: 'GET' });
            },

            async createEmployee(employee) {
                return this.request('/api/employees', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ employee: employee || {} })
                });
            },
            async upsertEmployee(username, employee) {
                return this.request('/api/employees/' + encodeURIComponent(String(username || '').trim()), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ employee: employee || {} })
                });
            },
            async patchEmployeeStatus(username, status, extra) {
                const body = Object.assign({ status: status }, extra && typeof extra === 'object' ? extra : {});
                return this.request('/api/employees/' + encodeURIComponent(String(username || '').trim()) + '/status', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            },
            async resetEmployeePassword(username, password) {
                return this.request('/api/employees/' + encodeURIComponent(String(username || '').trim()) + '/password', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: password == null ? '123456' : String(password) })
                });
            },
            async deleteEmployeeApi(username) {
                return this.request('/api/employees/' + encodeURIComponent(String(username || '').trim()), {
                    method: 'DELETE'
                });
            },
            async getUnreadCounts() {
                return this.request('/api/unread-counts', { method: 'GET' });
            },
            async getOpsTasks(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.status) q.set('status', String(p.status));
                if (p.date) q.set('date', String(p.date));
                if (p.store) q.set('store', String(p.store));
                if (p.limit != null) q.set('limit', String(p.limit));
                const qs = q.toString();
                return this.request('/api/ops/tasks' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async markOpsTaskRead(id) {
                return this.request('/api/ops/tasks/' + encodeURIComponent(String(id || '')) + '/read', {
                    method: 'POST'
                });
            },
            async uploadOpsTaskEvidence(formData) {
                return this.request('/api/uploads/ops-task-evidence', {
                    method: 'POST',
                    body: formData
                });
            },
            async completeOpsTask(id, payload) {
                return this.request('/api/ops/tasks/' + encodeURIComponent(String(id || '')) + '/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async batchRead(module, keys) {
                const m = String(module || '').trim();
                const ks = Array.isArray(keys) ? keys : [];
                try { __hrmsLocalMarkRead(m, ks); } catch (e) {}
                try {
                    const token = this.token();
                    if (!token) return { ok: true, inserted: ks.length, localOnly: true };
                } catch (e) {
                    return { ok: true, inserted: ks.length, localOnly: true };
                }
                return this.request('/api/reads/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ module: m, keys: ks })
                });
            },
            async uploadEmployeeIdCard(formData) {
                return this.request('/api/uploads/employee-idcard', {
                    method: 'POST',
                    body: formData
                });
            },
            async uploadEmployeeAttachment(empId, formData) {
                return this.request('/api/employees/' + encodeURIComponent(String(empId || '')) + '/attachments', {
                    method: 'POST',
                    body: formData
                });
            },
            async getEmployeeAttachments(empId) {
                return this.request('/api/employees/' + encodeURIComponent(String(empId || '')) + '/attachments', { method: 'GET' });
            },
            async deleteEmployeeAttachment(empId, attachId) {
                return this.request('/api/employees/' + encodeURIComponent(String(empId || '')) + '/attachments/' + encodeURIComponent(String(attachId || '')), { method: 'DELETE' });
            },
            async uploadPointsEvidence(formData) {
                return this.request('/api/uploads/points-evidence', {
                    method: 'POST',
                    body: formData
                });
            },
            async getPointRules(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.store) q.set('store', String(p.store));
                const qs = q.toString();
                return this.request('/api/points/rules' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async createPointRule(payload) {
                return this.request('/api/points/rules', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async updatePointRule(id, payload) {
                return this.request('/api/points/rules/' + encodeURIComponent(String(id || '')), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async getMyPoints() {
                return this.request('/api/points/my', { method: 'GET' });
            },
            async getPointsRanking(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.month) q.set('month', String(p.month));
                if (p.store) q.set('store', String(p.store));
                const qs = q.toString();
                return this.request('/api/points/ranking' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async getPointRecords(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.store) q.set('store', String(p.store));
                if (p.name) q.set('name', String(p.name));
                if (p.start) q.set('start', String(p.start));
                if (p.end) q.set('end', String(p.end));
                if (p.recordStatus) q.set('recordStatus', String(p.recordStatus));
                const qs = q.toString();
                return this.request('/api/points/records' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async checkin(payload) {
                return this.request('/api/checkin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async getCheckinToday() {
                return this.request('/api/checkin/today', { method: 'GET' });
            },
            async getCheckinRecords(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.username) q.set('username', String(p.username));
                if (p.name) q.set('name', String(p.name));
                if (p.store) q.set('store', String(p.store));
                if (p.start) q.set('start', String(p.start));
                if (p.end) q.set('end', String(p.end));
                if (p.status) q.set('status', String(p.status));
                const qs = q.toString();
                return this.request('/api/checkin/records' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async confirmCheckin(id, payload) {
                return this.request('/api/checkin/' + encodeURIComponent(String(id || '')) + '/confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async getCheckinSummary(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.month) q.set('month', String(p.month));
                if (p.store) q.set('store', String(p.store));
                const qs = q.toString();
                return this.request('/api/checkin/summary' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async getLeaveOwedReport(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.month) q.set('month', String(p.month));
                if (p.store) q.set('store', String(p.store));
                if (p.includeInactive) q.set('includeInactive', '1');
                const qs = q.toString();
                return this.request('/api/reports/leave-owed' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async getProfileAttendanceOverview(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.month) q.set('month', String(p.month));
                const qs = q.toString();
                return this.request('/api/profile/attendance-overview' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async setStoreLocation(storeName, payload) {
                return this.request('/api/stores/' + encodeURIComponent(String(storeName || '')) + '/location', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
            },
            async getApprovals(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.view) q.set('view', String(p.view));
                if (p.status) q.set('status', String(p.status));
                if (p.type) q.set('type', String(p.type));
                if (p.store) q.set('store', String(p.store));
                if (p.limit != null) q.set('limit', String(p.limit));
                if (p.dateStart) q.set('dateStart', String(p.dateStart));
                if (p.dateEnd) q.set('dateEnd', String(p.dateEnd));
                if (p.dateField) q.set('dateField', String(p.dateField));
                if (p.approvedStart) q.set('approvedStart', String(p.approvedStart));
                if (p.approvedEnd) q.set('approvedEnd', String(p.approvedEnd));
                if (p.approver) q.set('approver', String(p.approver));
                if (p.search) q.set('search', String(p.search));
                const qs = q.toString();
                return this.request('/api/approvals' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async getApproval(id) {
                return this.request('/api/approvals/' + encodeURIComponent(String(id || '')), { method: 'GET' });
            },
            async createApproval(type, payload) {
                return this.request('/api/approvals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: String(type || ''), payload: payload || {} })
                });
            },
            async readApproval(id) {
                return this.request('/api/approvals/' + encodeURIComponent(String(id || '')) + '/read', { method: 'POST' });
            },
            async decideApproval(id, approved, note, extra) {
                const body = { approved: !!approved, note: String(note || '') };
                if (extra && typeof extra === 'object') Object.assign(body, extra);
                return this.request('/api/approvals/' + encodeURIComponent(String(id || '')) + '/decide', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            },
            async returnApproval(id, note) {
                return this.request('/api/approvals/' + encodeURIComponent(String(id || '')) + '/return', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note: String(note || '') })
                });
            },
            async resubmitApproval(id, body) {
                const b = body && typeof body === 'object' ? body : {};
                return this.request('/api/approvals/' + encodeURIComponent(String(id || '')) + '/resubmit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(b)
                });
            },
            async payPayment(id, note) {
                return this.request('/api/payments/' + encodeURIComponent(String(id || '')) + '/pay', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note: String(note || '') })
                });
            },

            async getPaymentBudgetSummary(params) {
                const p = params && typeof params === 'object' ? params : {};
                const q = new URLSearchParams();
                if (p.store) q.set('store', String(p.store));
                if (p.month) q.set('month', String(p.month));
                if (p.category) q.set('category', String(p.category));
                if (p.excludeId) q.set('excludeId', String(p.excludeId));
                const qs = q.toString();
                return this.request('/api/payments/budget-summary' + (qs ? ('?' + qs) : ''), { method: 'GET' });
            },
            async getPromotionTracks() {
                return this.request('/api/promotion/tracks', { method: 'GET' });
            },
        };

        let __APPROVALS_CACHE = [];
        let __CURRENT_APPROVAL = null;
        let __APPROVALS_SELECTED = new Set();
        let __UNREAD_BADGES_TIMER = null;

        function __hrmsLocalReadsKey(module) {
            const u = String(currentUser?.username || currentUser?.id || '').trim();
            return `HRMS_LOCAL_READS_${String(module || '').trim()}_${u}`;
        }

        function __hrmsGetLocalReadSet(module) {
            try {
                const key = __hrmsLocalReadsKey(module);
                const raw = localStorage.getItem(key);
                const arr = hrmsSafeParseJson(raw) || [];
                const set = new Set();
                if (Array.isArray(arr)) {
                    arr.forEach(k => {
                        const v = String(k || '').trim();
                        if (v) set.add(v);
                    });
                }
                return set;
            } catch (e) {
                return new Set();
            }
        }

        function __hrmsSetLocalReadSet(module, set) {
            try {
                const key = __hrmsLocalReadsKey(module);
                const arr = Array.from(set || []).slice(0, 5000);
                localStorage.setItem(key, JSON.stringify(arr));
            } catch (e) {}
        }

        function __hrmsLocalMarkRead(module, keys) {
            const ks = Array.isArray(keys) ? keys : [];
            if (!currentUser) return;
            const set = __hrmsGetLocalReadSet(module);
            ks.forEach(k => {
                const v = String(k || '').trim();
                if (v) set.add(v);
            });
            __hrmsSetLocalReadSet(module, set);
        }

        function __hrmsComputeLocalUnreadCounts() {
            if (!currentUser) return { approvals: 0, training: 0, exam: 0 };

            const username = String(currentUser?.username || currentUser?.id || '').trim();
            const myStore = String(currentUser?.store || '').trim();
            const myDept = String(currentUser?.department || '').trim();
            const myPos = String(currentUser?.position || '').trim();
            const examRead = __hrmsGetLocalReadSet('exam');

            const training = 0;

            let exam = 0;
            try {
                const assignments = HRMS_STORE.getExamAssignments ? (HRMS_STORE.getExamAssignments() || []) : [];
                for (const a of assignments) {
                    const id = String(a?.id || '').trim();
                    if (!id) continue;
                    if (examRead.has(id)) continue;
                    try {
                        if (!examAssignmentMatchesUser(a, currentUser)) continue;
                    } catch (e2) {}
                    exam += 1;
                }
            } catch (e) {}

            return { approvals: 0, training, exam };
        }

        function refreshUnreadBadges() {
            try {
                if (!isLoggedIn || !currentUser) return;
            } catch (e) {
                return;
            }

            const setBadge = (id, n) => {
                const el = document.getElementById(id);
                if (!el) return;
                const v = Number(n || 0);
                if (Number.isFinite(v) && v > 0) {
                    el.textContent = v > 99 ? '99+' : String(v);
                    el.style.display = '';
                } else {
                    el.style.display = 'none';
                }
            };

            const token = (HRMS_API && typeof HRMS_API.token === 'function') ? String(HRMS_API.token() || '').trim() : '';
            if (!token) {
                const counts = __hrmsComputeLocalUnreadCounts();
                setBadge('nav-badge-approvals', counts.approvals);
                setBadge('nav-badge-exam', counts.exam);
                setBadge('nav-badge-knowledge', 0);
                setBadge('nav-badge-rewards', 0);
                return;
            }

            HRMS_API.getUnreadCounts()
                .then(resp => {
                    const counts = resp && typeof resp === 'object' ? resp : {};
                    const localCounts = __hrmsComputeLocalUnreadCounts();
                    setBadge('nav-badge-approvals', counts.approvals);
                    setBadge('nav-badge-exam', Math.max(Number(counts.exam || 0), Number(localCounts.exam || 0)));
                    setBadge('nav-badge-knowledge', counts.training);
                    setBadge('nav-badge-rewards', counts.rewards);
                    setBadge('nav-badge-payment', counts.payment);
                })
                .catch(() => {
                    const counts = __hrmsComputeLocalUnreadCounts();
                    setBadge('nav-badge-approvals', counts.approvals);
                    setBadge('nav-badge-exam', counts.exam);
                    setBadge('nav-badge-knowledge', 0);
                    setBadge('nav-badge-rewards', 0);
                    setBadge('nav-badge-payment', 0);
                });
        }

        function approvalStatusText(st) {
            const s = String(st || '').trim();
            if (s === 'pending') return '待处理';
            if (s === 'approved') return '已通过';
            if (s === 'paid') return '已付款';
            if (s === 'rejected') return '已拒绝';
            if (s === 'returned') return '已退回';
            return s || '-';
        }

        function approvalTypeText(tp) {
            const t = String(tp || '').trim();
            if (t === 'onboarding') return '入职';
            if (t === 'offboarding') return '离职';
            if (t === 'leave') return '休假';
            if (t === 'payment') return '请款';
            if (t === 'reward_punishment') return '奖惩';
            if (t === 'points') return '积分';
            if (t === 'promotion') return '晋升';
            if (t === 'monthly_confirm') return '月度考勤确认';
            return t || '审批';
        }

        function apSwitchView(view) {
            // 更新隐藏 select（保持原有数据逻辑不变）
            const sel = document.getElementById('approvals-view');
            if (sel) sel.value = view;
            // 更新 tab 高亮
            document.querySelectorAll('#ap-view-tabs .ap-view-tab').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });
            loadApprovalsData();
        }

        function loadApprovalsData() {
            const box = document.getElementById('approvals-list');
            const empty = document.getElementById('approvals-empty');
            if (!box || !empty) return;

            const viewEl = document.getElementById('approvals-view');
            const statusEl = document.getElementById('approvals-status');
            const approvedStartEl = document.getElementById('approvals-approved-start');
            const approvedEndEl = document.getElementById('approvals-approved-end');
            const dateFieldEl = document.getElementById('approvals-date-field');
            const typeFilterEl = document.getElementById('approvals-type-filter');
            const searchEl = document.getElementById('approvals-search');
            try {
                const role = String(currentUser?.role || '').trim();
                const canSeeAll = (role === ROLES.ADMIN || role === ROLES.HQ_MANAGER || role === ROLES.CASHIER);
                const allOpt = viewEl ? viewEl.querySelector('option[value="all"]') : null;
                if (allOpt) {
                    allOpt.style.display = canSeeAll ? '' : 'none';
                    allOpt.disabled = !canSeeAll;
                }
                if (!canSeeAll && String(viewEl?.value || '') === 'all') {
                    if (viewEl) viewEl.value = 'assigned';
                }
            } catch (e) {}
            const view = String(viewEl?.value || 'assigned');
            const status = String(statusEl?.value || '').trim();
            const approvedStart = String(approvedStartEl?.value || '').trim();
            const approvedEnd = String(approvedEndEl?.value || '').trim();
            const dateField = String(dateFieldEl?.value || 'created').trim();
            const typeFilter = String(typeFilterEl?.value || '').trim();
            const search = String(searchEl?.value || '').trim();
            const lim = view === 'all' ? 500 : 200;

            box.innerHTML = '<div class="ap-hint" style="padding:22px;text-align:center;">加载中…</div>';
            empty.style.display = 'none';

            // 不按当前门店过滤待审批：多店店长/出品经理（如喻烽兼管马己仙）必须能看到所有
            // 「指派给自己」的待办；后端 view=assigned 已按 current_assignee/链路过滤，
            // 再叠加门店过滤会把兼管门店（如马己仙）的单据误藏。请款按门店的过滤由后端独立处理。
            HRMS_API.getApprovals({ view: String(viewEl?.value || 'assigned'), status, type: typeFilter || undefined, dateStart: approvedStart, dateEnd: approvedEnd, dateField, search, limit: lim })
                .then(resp => {
                    const items = Array.isArray(resp?.items) ? resp.items : [];
                    __APPROVALS_CACHE = items;
                    renderApprovalsList(items);
                    try { refreshUnreadBadges(); } catch (e) {}
                })
                .catch(e => {
                    box.innerHTML = '';
                    empty.style.display = '';
                    showNotification('加载审批失败：' + String(e?.message || e), 'error');
                });
        }

        function renderApprovalsList(items) {
            const box = document.getElementById('approvals-list');
            const empty = document.getElementById('approvals-empty');
            const bulkBtn = document.getElementById('approvals-bulk-approve-btn');
            if (!box || !empty) return;

            const list = (Array.isArray(items) ? items : []).filter(it => {
                if (currentUser && currentUser.role === 'store_production_manager' && String(it?.type || '') === 'points') return false;
                return true;
            });
            const canBulkApproveType = (item) => {
                const t = String(item?.type || '').trim();
                return ['points', 'reward_punishment', 'monthly_confirm', 'payment'].includes(t);
            };
            const refreshBulkBtn = () => {
                if (!bulkBtn) return;
                const view = String(document.getElementById('approvals-view')?.value || 'assigned').trim();
                bulkBtn.style.display = view === 'assigned' ? '' : 'none';
                const selectedCount = Array.from(__APPROVALS_SELECTED || []).filter(Boolean).length;
                bulkBtn.textContent = selectedCount > 0 ? `批量通过（${selectedCount}）` : '批量通过';
                bulkBtn.disabled = selectedCount <= 0;
            };
            if (!list.length) {
                __APPROVALS_SELECTED = new Set();
                refreshBulkBtn();
                box.innerHTML = '';
                empty.style.display = '';
                return;
            }
            empty.style.display = 'none';
            const validIds = new Set(list.map(it => String(it?.id || '').trim()).filter(Boolean));
            __APPROVALS_SELECTED = new Set(Array.from(__APPROVALS_SELECTED || []).filter(id => validIds.has(id)));
            refreshBulkBtn();

            const approvalCardHtml = (it) => {
                const id = String(it?.id || '').trim();
                const type = approvalTypeText(it?.type);
                const rawType = String(it?.type || '').trim();
                const rawStatus = String(it?.status || '').trim();
                const st = (rawType === 'payment' && rawStatus === 'approved') ? '已审核' : approvalStatusText(rawStatus);
                const who = String(it?.applicant_name || '').trim() || hrmsDisplayName(it?.applicant_username);
                const assignee = String(it?.current_assignee_name || '').trim() || hrmsDisplayName(it?.current_assignee_username);
                const createdAt = String(it?.created_at || it?.createdAt || '').slice(0, 16).replace('T', ' ');
                const timeStr = createdAt ? createdAt.slice(5).replace(' ', ' ') : '';

                // overdue detection (> 48h for pending items)
                const isOverdue = rawStatus === 'pending' && createdAt && (Date.now() - new Date(createdAt.replace(' ', 'T') + ':00').getTime()) > 48 * 3600 * 1000;

                const rawAssignee = String(it?.current_assignee_username || '').trim();
                const myUn = String(currentUser?.username || '').toLowerCase();
                const chainMatch = Array.isArray(it?.chain) && it.chain.some(s => String(s?.assignee || '').toLowerCase() === myUn && String(s?.status || '') === 'pending');
                const canAct = String(it?.status || '') === 'pending' && myUn && (rawAssignee.toLowerCase() === myUn || chainMatch);
                const canBulk = canAct && canBulkApproveType(it);
                const checked = canBulk && __APPROVALS_SELECTED.has(id);

                // status badge class
                const badgeClass = rawStatus === 'pending' ? 'ga-badge--pending'
                    : rawStatus === 'approved' ? 'ga-badge--approved'
                    : rawStatus === 'paid'     ? 'ga-badge--paid'
                    : rawStatus === 'rejected' ? 'ga-badge--rejected'
                    : rawStatus === 'returned' ? 'ga-badge--returned'
                    : 'ga-badge--returned';

                // urgent badge
                const urgentBadge = isOverdue
                    ? '<span class="ga-badge ga-badge--urgent"><span class="ga-pulse-dot"></span>逾期</span>'
                    : (canAct ? '<span class="ga-badge ga-badge--urgent">待处理</span>' : '');

                // type icon
                const ICON_MAP = { leave: '✈', payment: '¥', onboarding: '+', offboarding: '←', reward_punishment: '★', points: '₽', promotion: '↑', monthly_confirm: '✓' };
                const iconChar = ICON_MAP[rawType] || '●';

                const cardClasses = ['ap-card'];
                if (isOverdue) cardClasses.push('ap-card--overdue');
                if (canAct) cardClasses.push('ap-card--urgent');
                if (rawStatus !== 'pending') cardClasses.push('ap-card--done');

                const titleText = who && who !== '-' ? who + ' · ' + type + '申请' : type + '申请';
                const metaParts = [];
                if (assignee && assignee !== '-') metaParts.push('<span>审批人<br>' + escapeHtml(assignee) + '</span>');

                return '<div class="' + cardClasses.join(' ') + '" onclick="openApprovalDetailModal(\'' + escapeHtml(id) + '\')">'
                    + '<div class="ap-card__top">'
                    +   '<div class="ap-card__icon ap-card__icon--' + escapeHtml(rawType) + '">' + iconChar + '</div>'
                    +   '<div class="ap-card__info">'
                    +     '<div class="ap-card__title">' + escapeHtml(titleText) + '</div>'
                    +     (metaParts.length ? '<div class="ap-card__meta">' + metaParts.join('') + '</div>' : '')
                    +   '</div>'
                    +   '<span class="ga-badge ' + badgeClass + '">' + escapeHtml(st) + '</span>'
                    +   urgentBadge
                    + '</div>'
                    + '<div class="ap-card__bottom">'
                    +   '<span class="ap-card__time">' + escapeHtml(timeStr) + '</span>'
                    +   '<div class="ap-card__actions">'
                    +     (canBulk ? '<label class="ap-card__checkbox-wrap"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="toggleApprovalSelection(\'' + escapeHtml(id) + '\', this.checked)">批量选择</label>' : '<span></span>')
                    +     '<button class="ga-btn ga-btn--ghost ga-btn--sm" type="button" onclick="event.stopPropagation();openApprovalDetailModal(\'' + escapeHtml(id) + '\')">查看详情</button>'
                    +   '</div>'
                    + '</div>'
                    + '</div>';
            };

            const viewNow = String(document.getElementById('approvals-view')?.value || 'assigned').trim();
            const TYPE_ORDER = ['onboarding', 'offboarding', 'leave', 'payment', 'points', 'reward_punishment', 'promotion', 'monthly_confirm'];
            if (viewNow === 'all') {
                const buckets = new Map();
                list.forEach((it) => {
                    const k = String(it?.type || '_other');
                    if (!buckets.has(k)) buckets.set(k, []);
                    buckets.get(k).push(it);
                });
                const parts = [];
                const emitType = (tk) => {
                    const sub = buckets.get(tk);
                    if (!sub || !sub.length) return;
                    parts.push('<div class="ap-type-group">' + escapeHtml(approvalTypeText(tk)) + '<span style="opacity:0.65;font-weight:600;">' + sub.length + '</span></div>');
                    sub.forEach((row) => parts.push(approvalCardHtml(row)));
                    buckets.delete(tk);
                };
                TYPE_ORDER.forEach(emitType);
                Array.from(buckets.keys()).sort().forEach(emitType);
                box.innerHTML = parts.join('');
            } else {
                box.innerHTML = list.map(approvalCardHtml).join('');
            }
            refreshBulkBtn();

            // 更新统计数据 & 页头
            apUpdateStats(list);
            apUpdateHeaderMeta(list);
        }

        function apUpdateStats(list) {
            const now = Date.now();
            const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
            const pending = list.filter(it => String(it?.status || '') === 'pending').length;
            const approvedThisMonth = list.filter(it => {
                const rawStatus = String(it?.status || '');
                if (rawStatus !== 'approved') return false;
                const createdAt = String(it?.created_at || it?.createdAt || '');
                return createdAt && new Date(createdAt).getTime() >= thisMonthStart;
            }).length;
            const urgent = list.filter(it => {
                if (String(it?.status || '') !== 'pending') return false;
                const createdAt = String(it?.created_at || it?.createdAt || '');
                return createdAt && (now - new Date(createdAt).getTime()) > 48 * 3600 * 1000;
            }).length;
            const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            setVal('ap-stat-total', list.length);
            setVal('ap-stat-pending', pending);
            setVal('ap-stat-approved', approvedThisMonth);
            setVal('ap-stat-urgent', urgent);
        }

        function apUpdateHeaderMeta(list) {
            const elCount = document.getElementById('ap-head-count');
            const elUpdated = document.getElementById('ap-head-updated');
            if (elCount) elCount.textContent = list.length;
            if (elUpdated) {
                const now = new Date();
                elUpdated.textContent = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
            }
        }

        function toggleApprovalSelection(id, checked) {
            const key = String(id || '').trim();
            if (!key) return;
            if (!(__APPROVALS_SELECTED instanceof Set)) __APPROVALS_SELECTED = new Set();
            if (checked) __APPROVALS_SELECTED.add(key);
            else __APPROVALS_SELECTED.delete(key);
            const bulkBtn = document.getElementById('approvals-bulk-approve-btn');
            if (bulkBtn) {
                const n = __APPROVALS_SELECTED.size;
                bulkBtn.textContent = n > 0 ? `批量通过（${n}）` : '批量通过';
                bulkBtn.disabled = n <= 0;
            }
        }

        async function bulkApproveSelectedApprovals() {
            const ids = Array.from(__APPROVALS_SELECTED || []);
            if (!ids.length) {
                showNotification('请先勾选要批量通过的审批', 'warning');
                return;
            }
            const safeIds = ids.filter((id) => {
                const item = (__APPROVALS_CACHE || []).find(x => String(x?.id || '') === id);
                const t = String(item?.type || '').trim();
                return ['points', 'reward_punishment', 'monthly_confirm', 'payment'].includes(t);
            });
            if (!safeIds.length) {
                showNotification('当前勾选项不支持批量通过', 'warning');
                return;
            }
            if (!confirm(`确认批量通过 ${safeIds.length} 条审批？仅会处理无需额外填写字段的审批。`)) return;
            let ok = 0;
            const failed = [];
            const bulkBtn = document.getElementById('approvals-bulk-approve-btn');
            const prevText = bulkBtn ? bulkBtn.textContent : '';
            if (bulkBtn) {
                bulkBtn.disabled = true;
                bulkBtn.textContent = '批量处理中...';
            }
            for (const id of safeIds) {
                try {
                    await HRMS_API.decideApproval(id, true, '');
                    ok += 1;
                } catch (e) {
                    failed.push(`${id}: ${String(e?.message || e)}`);
                }
            }
            __APPROVALS_SELECTED = new Set();
            if (bulkBtn) {
                bulkBtn.textContent = prevText || '批量通过';
            }
            await loadApprovalsData();
            if (!failed.length) {
                showNotification(`批量审批成功，共 ${ok} 条`, 'success');
            } else {
                showNotification(`批量审批完成，成功 ${ok} 条，失败 ${failed.length} 条`, failed.length < safeIds.length ? 'warning' : 'error');
                console.warn('[bulk-approve] failed items:', failed);
            }
        }

        async function uploadPointsEvidence() {
            const fileEl = document.getElementById('points-apply-evidence-files');
            const hintEl = document.getElementById('points-apply-evidence-hint');
            const listEl = document.getElementById('points-evidence-list');
            const files = fileEl?.files ? Array.from(fileEl.files) : [];
            if (!files.length) {
                showNotification('请先选择图片', 'warning');
                return;
            }
            if (files.length > 6) {
                showNotification('最多上传6张图片', 'warning');
                return;
            }
            const fd = new FormData();
            files.forEach(f => fd.append('files', f));
            try {
                if (hintEl) hintEl.textContent = '上传中...';
                const resp = await HRMS_API.uploadPointsEvidence(fd);
                const urls = Array.isArray(resp?.urls) ? resp.urls.map(x => String(x || '').trim()).filter(Boolean) : [];
                __POINTS_EVIDENCE_URLS = urls;
                if (listEl) {
                    const base = String(HRMS_API.baseUrl ? HRMS_API.baseUrl() : '').replace(/\/$/, '');
                    const toAbs = (u) => {
                        const s = String(u || '').trim();
                        if (!s) return '';
                        if (/^https?:\/\//i.test(s)) return s;
                        if (!base) return s;
                        return s.startsWith('/') ? (base + s) : (base + '/' + s);
                    };
                    listEl.innerHTML = urls.length
                        ? `<div style="display:flex; gap:8px; flex-wrap:wrap;">${urls.map((u, i) => {
                            const abs = toAbs(u);
                            return `<a href="${escapeHtml(abs)}" target="_blank" rel="noopener" title="打开证据${i + 1}" style="position:relative; display:block; width:72px; height:72px; border-radius:10px; overflow:hidden; border:1px solid rgba(201,169,106,0.35); background:rgba(255,255,255,0.04);"><img src="${escapeHtml(abs)}" alt="证据${i + 1}" style="width:100%; height:100%; object-fit:cover;"><span style="position:absolute; right:4px; bottom:4px; font-size:10px; color:#fde68a; background:rgba(2,6,23,0.65); border-radius:6px; padding:1px 5px;">${i + 1}</span></a>`;
                        }).join('')}</div>`
                        : '未上传成功';
                }
                if (hintEl) hintEl.textContent = urls.length ? `已上传 ${urls.length} 张` : '未上传成功';
                showNotification(urls.length ? '证明图片上传完成' : '未上传成功', urls.length ? 'success' : 'warning');
            } catch (e) {
                if (hintEl) hintEl.textContent = '上传失败';
                showNotification('图片上传失败：' + String(e?.message || e), 'error');
            }
        }

        let __POINTS_RULES_CACHE = [];
        let __POINTS_APPLY_COUNTER = 0;
        let __POINTS_RET_ROW_SEQ = 0;

        async function ensurePointsRulesCacheForResubmit() {
            if (__POINTS_RULES_CACHE && __POINTS_RULES_CACHE.length) return;
            try {
                const rulesResp = await HRMS_API.getPointRules({ store: String(currentUser?.store || '').trim() });
                const rules = (Array.isArray(rulesResp?.items) ? rulesResp.items : [])
                    .filter(r => r?.enabled !== false)
                    .sort((a, b) => Number(b?.points || 0) - Number(a?.points || 0));
                __POINTS_RULES_CACHE = rules;
            } catch (e) {
                if (!__POINTS_RULES_CACHE) __POINTS_RULES_CACHE = [];
            }
        }

        async function initPointsReturnedResubmitEditor() {
            const rowsEl = document.getElementById('points-returned-rows');
            if (!rowsEl) return;
            await ensurePointsRulesCacheForResubmit();
            rowsEl.innerHTML = '';
            __POINTS_RET_ROW_SEQ = 0;
            const cur = __CURRENT_APPROVAL;
            const p = cur?.payload && typeof cur.payload === 'object' ? cur.payload : {};
            const batch = Array.isArray(p.items) && p.items.length
                ? p.items.slice()
                : (String(p.ruleId || '').trim() ? [{ ruleId: p.ruleId, reason: p.reason || '', itemName: p.itemName, points: p.points }] : []);
            if (!batch.length) {
                addPointsReturnedResubmitRow({});
                return;
            }
            batch.forEach((it) => {
                addPointsReturnedResubmitRow({
                    ruleId: it.ruleId,
                    reason: it.reason,
                    itemName: it.itemName,
                    points: it.points
                });
            });
        }

        function addPointsReturnedResubmitRow(prefill) {
            const container = document.getElementById('points-returned-rows');
            if (!container) return;
            const count = container.querySelectorAll('.pts-ret-item').length;
            if (count >= 20) { showNotification('单次最多申请20条', 'warning'); return; }
            __POINTS_RET_ROW_SEQ++;
            const idx = __POINTS_RET_ROW_SEQ;
            const rules = __POINTS_RULES_CACHE || [];
            const rulesHtml = rules.length
                ? rules.map((r, ri) => `<div class="pts-rule-opt pts-ret-rule-opt" data-rid="${escapeHtml(String(r?.id||''))}" data-pts="${Number(r?.points||0)}" onclick="selectPointsReturnedRule(this,${idx})" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;${ri < rules.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.06);' : ''}cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background 0.18s ease;"><span style="flex:1;font-size:13px;color:rgba(226,232,240,0.9);line-height:1.5;padding-right:10px;">${escapeHtml(String(r?.itemName||'-'))}<span style="display:inline-block;margin-left:6px;font-size:11px;font-weight:700;color:rgba(201,169,106,0.82);">+${Number(r?.points||0)}分</span></span><div class="pts-radio-dot" style="width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,0.2);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.15s ease;background:rgba(255,255,255,0.04);"></div></div>`).join('')
                : '<div style="padding:18px;text-align:center;color:rgba(200,215,230,0.45);font-size:13px;">暂无可用事项</div>';
            const itemDiv = document.createElement('div');
            itemDiv.className = 'pts-ret-item';
            itemDiv.setAttribute('data-idx', String(idx));
            itemDiv.style.cssText = 'padding:14px;border-radius:14px;border:1px solid rgba(99,102,241,0.28);background:rgba(15,23,42,0.45);position:relative;';
            const ruleBlock = `<input type="hidden" class="pts-ret-rule" value="">
                    <div id="pts-ret-picker-${idx}" style="border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.12);background:rgba(30,41,59,0.65);max-height:min(48vh,260px);overflow-y:auto;-webkit-overflow-scrolling:touch;">
                        <div style="padding:8px 12px;font-size:10px;font-weight:700;letter-spacing:0.1em;color:rgba(186,230,253,0.5);border-bottom:1px solid rgba(255,255,255,0.07);pointer-events:none;">选择积分事项</div>
                        ${rulesHtml}
                    </div>`;
            itemDiv.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <span class="pts-ret-seq" style="font-size:12px;font-weight:700;color:#a5b4fc;">第 ${count + 1} 条</span>
                    ${count > 0 ? `<button type="button" onclick="removePointsReturnedResubmitRow(this)" style="background:none;border:none;color:rgba(239,68,68,0.85);font-size:16px;cursor:pointer;padding:0 4px;line-height:1;" title="删除此条">✕</button>` : ''}
                </div>
                <div style="margin-bottom:8px;">
                    <label style="display:block;font-size:11px;font-weight:600;color:rgba(200,215,230,0.72);margin-bottom:6px;">申请事项</label>
                    ${ruleBlock}
                </div>
                <div>
                    <label style="display:block;font-size:11px;font-weight:600;color:rgba(200,215,230,0.72);margin-bottom:4px;">申请理由</label>
                    <textarea class="form-input pts-ret-reason" placeholder="请填写具体表现与贡献" style="width:100%;min-height:56px;padding:10px 12px;border-radius:10px;font-size:13px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:rgba(226,232,240,0.95);resize:vertical;"></textarea>
                </div>
            `;
            container.appendChild(itemDiv);
            const pf = prefill && typeof prefill === 'object' ? prefill : {};
            const rid = String(pf.ruleId || '').trim();
            const ta = itemDiv.querySelector('textarea.pts-ret-reason');
            if (ta && pf.reason != null) ta.value = String(pf.reason);
            if (rid) {
                const picker = document.getElementById('pts-ret-picker-' + idx);
                let hit = null;
                if (picker) {
                    picker.querySelectorAll('.pts-ret-rule-opt').forEach((o) => {
                        if (String(o.getAttribute('data-rid') || '') === rid) hit = o;
                    });
                }
                if (hit) selectPointsReturnedRule(hit, idx);
                else {
                    const warn = document.createElement('div');
                    warn.style.cssText = 'font-size:11px;color:#fb923c;margin:0 0 8px;line-height:1.45;';
                    const nm = String(pf.itemName || '').trim() || '原事项';
                    warn.textContent = '「' + nm + '」已不在可选列表，请从下方重新选择一项。';
                    const wrap = itemDiv.querySelector(`#pts-ret-picker-${idx}`);
                    if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(warn, wrap);
                }
            }
            refreshPointsReturnedRowChrome();
        }

        function selectPointsReturnedRule(el, idx) {
            const picker = document.getElementById('pts-ret-picker-' + idx);
            if (!picker) return;
            picker.querySelectorAll('.pts-ret-rule-opt').forEach(opt => {
                opt.style.background = '';
                opt.style.borderLeft = '';
                opt.style.paddingLeft = '14px';
                const dot = opt.querySelector('.pts-radio-dot');
                if (dot) { dot.style.border='2px solid rgba(255,255,255,0.18)'; dot.style.background='rgba(255,255,255,0.03)'; dot.innerHTML=''; }
            });
            el.style.background = 'rgba(99,102,241,0.13)';
            el.style.borderLeft = '3px solid rgba(129,140,248,0.65)';
            el.style.paddingLeft = '11px';
            const dot = el.querySelector('.pts-radio-dot');
            if (dot) {
                dot.style.border = '2px solid #818cf8';
                dot.style.background = 'rgba(99,102,241,0.28)';
                dot.innerHTML = '<div style="width:9px;height:9px;border-radius:50%;background:#a5b4fc;"></div>';
            }
            const itemDiv = el.closest('.pts-ret-item');
            if (itemDiv) {
                const hidden = itemDiv.querySelector('.pts-ret-rule');
                if (hidden) hidden.value = el.getAttribute('data-rid');
            }
        }

        function removePointsReturnedResubmitRow(btn) {
            const itemDiv = btn.closest('.pts-ret-item');
            if (itemDiv) itemDiv.remove();
            refreshPointsReturnedRowChrome();
        }

        function refreshPointsReturnedRowChrome() {
            const container = document.getElementById('points-returned-rows');
            if (!container) return;
            const items = container.querySelectorAll('.pts-ret-item');
            items.forEach((el, i) => {
                const numSpan = el.querySelector('.pts-ret-seq');
                if (numSpan) numSpan.textContent = `第 ${i + 1} 条`;
                const delBtn = el.querySelector('button[onclick*="removePointsReturnedResubmitRow"]');
                if (items.length <= 1) {
                    if (delBtn) delBtn.style.display = 'none';
                } else if (delBtn) delBtn.style.display = '';
            });
        }

        function addPointsApplyItem() {
            const container = document.getElementById('points-apply-items');
            if (!container) return;
            const count = container.querySelectorAll('.points-apply-item').length;
            if (count >= 20) { showNotification('单次最多申请20条', 'warning'); return; }
            __POINTS_APPLY_COUNTER++;
            const idx = __POINTS_APPLY_COUNTER;
            const rules = __POINTS_RULES_CACHE || [];
            const rulesHtml = rules.length
                ? rules.map((r, ri) => `<div class="pts-rule-opt" data-rid="${escapeHtml(String(r?.id||''))}" data-pts="${Number(r?.points||0)}" onclick="selectPointsRule(this,${idx})" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;${ri < rules.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.06);' : ''}cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background 0.18s ease;"><span style="flex:1;font-size:13px;color:rgba(226,232,240,0.9);line-height:1.5;padding-right:10px;">${escapeHtml(String(r?.itemName||'-'))}<span style="display:inline-block;margin-left:6px;font-size:11px;font-weight:700;color:rgba(201,169,106,0.82);">+${Number(r?.points||0)}分</span></span><div class="pts-radio-dot" style="width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,0.2);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.15s ease;background:rgba(255,255,255,0.04);"></div></div>`).join('')
                : '<div style="padding:18px;text-align:center;color:rgba(200,215,230,0.45);font-size:13px;">暂无可用事项</div>';
            const itemDiv = document.createElement('div');
            itemDiv.className = 'points-apply-item';
            itemDiv.setAttribute('data-idx', String(idx));
            itemDiv.style.cssText = 'padding:14px;border-radius:18px;border:1px solid rgba(255,255,255,0.1);background:linear-gradient(165deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02));position:relative;backdrop-filter:blur(16px) saturate(1.35);-webkit-backdrop-filter:blur(16px) saturate(1.35);box-shadow:inset 0 1px 0 rgba(255,255,255,0.08),0 8px 32px rgba(0,0,0,0.2);';
            const ruleBlock = `<input type="hidden" class="points-item-rule" value="">
                    <div id="pts-picker-${idx}" style="border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.12);background:linear-gradient(165deg,rgba(30,41,59,0.78),rgba(15,23,42,0.5));backdrop-filter:blur(22px) saturate(1.45);-webkit-backdrop-filter:blur(22px) saturate(1.45);box-shadow:inset 0 1px 0 rgba(255,255,255,0.1),0 12px 40px rgba(0,0,0,0.35);max-height:min(52vh,280px);overflow-y:auto;-webkit-overflow-scrolling:touch;">
                        <div style="padding:10px 14px;font-size:10px;font-weight:700;letter-spacing:0.12em;color:rgba(186,230,253,0.5);border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.04);pointer-events:none;">选择积分事项</div>
                        ${rulesHtml}
                    </div>`;
            itemDiv.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <span style="font-size:12px;font-weight:700;color:rgba(201,169,106,0.85);">第 ${count+1} 条</span>
                    ${count>0?`<button type="button" onclick="removePointsApplyItem(this)" style="background:none;border:none;color:rgba(239,68,68,0.75);font-size:18px;cursor:pointer;padding:0 4px;line-height:1;" title="删除此条">✕</button>`:''}
                </div>
                <div style="margin-bottom:10px;">
                    <label style="display:block;font-size:12px;font-weight:600;color:rgba(200,215,230,0.7);margin-bottom:8px;">申请事项</label>
                    ${ruleBlock}
                </div>
                <div>
                    <label style="display:block;font-size:12px;font-weight:600;color:rgba(200,215,230,0.7);margin-bottom:4px;">申请理由</label>
                    <textarea class="form-input points-item-reason" placeholder="请填写具体表现与贡献" style="width:100%;min-height:60px;padding:10px 12px;border-radius:10px;font-size:13px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:rgba(226,232,240,0.95);resize:vertical;"></textarea>
                </div>
            `;
            container.appendChild(itemDiv);
            updatePointsApplyBadge();
        }

        function selectPointsRule(el, idx) {
            const picker = document.getElementById('pts-picker-' + idx);
            if (!picker) return;
            picker.querySelectorAll('.pts-rule-opt').forEach(opt => {
                opt.style.background = '';
                opt.style.borderLeft = '';
                opt.style.paddingLeft = '14px';
                const dot = opt.querySelector('.pts-radio-dot');
                if (dot) { dot.style.border='2px solid rgba(255,255,255,0.18)'; dot.style.background='rgba(255,255,255,0.03)'; dot.innerHTML=''; }
            });
            el.style.background = 'rgba(99,102,241,0.13)';
            el.style.borderLeft = '3px solid rgba(129,140,248,0.65)';
            el.style.paddingLeft = '11px';
            const dot = el.querySelector('.pts-radio-dot');
            if (dot) {
                dot.style.border = '2px solid #818cf8';
                dot.style.background = 'rgba(99,102,241,0.28)';
                dot.innerHTML = '<div style="width:9px;height:9px;border-radius:50%;background:#a5b4fc;"></div>';
            }
            const itemDiv = el.closest('.points-apply-item');
            if (itemDiv) {
                const hidden = itemDiv.querySelector('.points-item-rule');
                if (hidden) hidden.value = el.getAttribute('data-rid');
            }
        }

        function removePointsApplyItem(btn) {
            const itemDiv = btn.closest('.points-apply-item');
            if (itemDiv) itemDiv.remove();
            // Re-number
            const container = document.getElementById('points-apply-items');
            if (container) {
                const items = container.querySelectorAll('.points-apply-item');
                items.forEach((el, i) => {
                    const numSpan = el.querySelector('span');
                    if (numSpan) numSpan.textContent = `第 ${i + 1} 条`;
                    const delBtn = el.querySelector('button[onclick*="removePointsApplyItem"]');
                    if (i === 0 && items.length === 1 && delBtn) delBtn.style.display = 'none';
                    else if (delBtn) delBtn.style.display = '';
                });
            }
            updatePointsApplyBadge();
        }

        function updatePointsApplyBadge() {
            const container = document.getElementById('points-apply-items');
            const badge = document.getElementById('points-apply-count-badge');
            if (!container || !badge) return;
            const count = container.querySelectorAll('.points-apply-item').length;
            badge.textContent = count > 1 ? `（${count}条）` : '';
        }

        async function submitPointsApplication() {
            const container = document.getElementById('points-apply-items');
            if (!container) return;
            const itemEls = container.querySelectorAll('.points-apply-item');
            if (!itemEls.length) { showNotification('请至少添加一条积分申请', 'warning'); return; }
            const items = [];
            for (let i = 0; i < itemEls.length; i++) {
                const el = itemEls[i];
                const ruleId = String(el.querySelector('.points-item-rule')?.value || '').trim();
                const reason = String(el.querySelector('.points-item-reason')?.value || '').trim();
                if (!ruleId) { showNotification(`第${i + 1}条请选择申请事项`, 'warning'); return; }
                if (!reason) { showNotification(`第${i + 1}条请填写申请理由`, 'warning'); return; }
                items.push({ ruleId, reason });
            }
            try {
                await HRMS_API.createApproval('points', {
                    items,
                    evidenceUrls: Array.isArray(__POINTS_EVIDENCE_URLS) ? __POINTS_EVIDENCE_URLS.slice() : []
                });
                const fileEl = document.getElementById('points-apply-evidence-files');
                if (fileEl) fileEl.value = '';
                const listEl = document.getElementById('points-evidence-list');
                if (listEl) listEl.innerHTML = '';
                __POINTS_EVIDENCE_URLS = [];
                showNotification(`${items.length}条积分申请已提交（直属上级 → 总部营运 → 总部人事）`, 'success');
                await loadPointsPageData();
            } catch (e) {
                showNotification('提交失败：' + String(e?.message || e), 'error');
            }
        }

        async function loadPointsPageData() {
            const role = String(currentUser?.role || '').trim();
            const isAdminView = role === ROLES.ADMIN || role === ROLES.HR_MANAGER || role === ROLES.HQ_MANAGER;
            const isStoreManagerView = role === ROLES.STORE_MANAGER;
            const isEmployee = !isAdminView && !isStoreManagerView;
            const monthPointsEl = document.getElementById('points-month-points');
            const monthAmountEl = document.getElementById('points-month-amount');
            const listEl = document.getElementById('points-records-list');
            const applyCard = document.getElementById('points-apply-card');
            const adminFilterCard = document.getElementById('points-admin-filter-card');
            const recordsTitleEl = document.getElementById('points-records-title');
            const isScopedView = isAdminView || isStoreManagerView;
            if (applyCard) applyCard.style.display = isEmployee ? '' : 'none';
            if (adminFilterCard) adminFilterCard.style.display = isScopedView ? '' : 'none';
            if (recordsTitleEl) {
                if (isAdminView) {
                    const ss = document.getElementById('points-admin-store');
                    const lab = ss && !ss.disabled ? String(ss.options[ss.selectedIndex]?.textContent || ss.value || '').trim() : '';
                    recordsTitleEl.textContent = lab && lab !== '全部门店' ? `积分记录（${lab}）` : '积分记录（全部门店）';
                } else if (isStoreManagerView) {
                    recordsTitleEl.textContent = `积分记录（${String(currentUser?.store || '').trim() || '本门店'}）`;
                } else {
                    recordsTitleEl.textContent = '我的积分记录';
                }
            }

            if (isScopedView) {
                const stores = (HRMS_STORE.getStores ? HRMS_STORE.getStores() : []) || [];
                const names = Array.from(new Set(stores.map(s => String(s?.name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
                const storeSel = document.getElementById('points-admin-store');
                if (storeSel) {
                    if (isStoreManagerView) {
                        const myStore = String(currentUser?.store || '').trim();
                        storeSel.innerHTML = myStore
                            ? `<option value="${escapeHtml(myStore)}">${escapeHtml(myStore)}</option>`
                            : '<option value="">本门店</option>';
                        storeSel.value = myStore;
                        storeSel.disabled = true;
                    } else {
                        const prev = String(storeSel.value || '').trim();
                        storeSel.innerHTML = '<option value="">全部门店</option>' + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
                        storeSel.value = names.includes(prev) ? prev : '';
                        storeSel.disabled = false;
                    }
                }
                try {
                    const stSel = document.getElementById('points-admin-record-status');
                    if (stSel && !String(stSel.value || '').trim()) stSel.value = 'approved';
                } catch (e) {}
                await queryPointsAdminRecords();
                loadPointsRanking();
                return;
            }

            try {
                const [myResp, rulesResp, approvalsResp] = await Promise.all([
                    HRMS_API.getMyPoints(),
                    HRMS_API.getPointRules({ store: String(currentUser?.store || '').trim() }),
                    HRMS_API.getApprovals({ view: 'created', type: 'points', limit: 200 })
                ]);

                const monthPoints = Number(myResp?.monthPoints || 0);
                const monthAmount = Number(myResp?.monthAmount || (monthPoints * 0.5));
                if (monthPointsEl) monthPointsEl.textContent = String(monthPoints);
                if (monthAmountEl) monthAmountEl.textContent = '¥' + monthAmount.toFixed(2);

                const rules = (Array.isArray(rulesResp?.items) ? rulesResp.items : [])
                    .filter(r => r?.enabled !== false)
                    .sort((a, b) => Number(b?.points || 0) - Number(a?.points || 0));
                __POINTS_RULES_CACHE = rules;
                // Initialize dynamic items container with one default item
                const itemsContainer = document.getElementById('points-apply-items');
                if (itemsContainer) {
                    itemsContainer.innerHTML = '';
                    __POINTS_APPLY_COUNTER = 0;
                    addPointsApplyItem();
                }

                const items = Array.isArray(approvalsResp?.items) ? approvalsResp.items : [];
                if (!items.length) {
                    if (listEl) listEl.innerHTML = '<div style="color:rgba(200,215,230,0.75);">暂无积分记录</div>';
                    loadPointsRanking();
                    return;
                }

                if (listEl) {
                    listEl.innerHTML = items.map(it => {
                        const p = it?.payload || {};
                        const itemName = String(p?.itemName || '积分事项').trim();
                        const pts = Number(p?.points || 0);
                        const st = approvalStatusText(it?.status);
                        const createdAt = String(it?.created_at || it?.createdAt || '').slice(0, 19).replace('T', ' ');
                        return `<details class="rep-row-details">
                            <summary class="rep-row-details__summary" style="align-items:flex-start;">
                                <span class="rep-row-details__sum-main">
                                    <span class="rep-row-details__sum-title">${escapeHtml(itemName)} · ${pts}分</span>
                                    <span class="rep-row-details__sum-meta">${escapeHtml(createdAt || '-')}</span>
                                </span>
                                <span style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                                    <span class="rep-row-details__sum-badge">${escapeHtml(st)}</span>
                                    <span class="rep-row-details__chev" aria-hidden="true">▼</span>
                                </span>
                            </summary>
                            <div class="rep-row-details__body">
                                <div style="font-size:12px; color:rgba(200,215,230,0.65); margin-bottom:10px;">展开后可查看审批详情。</div>
                                <button class="btn btn-secondary" type="button" style="padding:6px 10px; font-size:12px;" onclick="event.stopPropagation(); openApprovalDetailModal('${escapeHtml(String(it?.id || ''))}')">查看详情</button>
                            </div>
                        </details>`;
                    }).join('');
                }
                loadPointsRanking();
            } catch (e) {
                if (listEl) listEl.innerHTML = '<div style="color:#ef4444;">加载失败：' + escapeHtml(String(e?.message || e)) + '</div>';
            }
        }

        function hrmsShanghaiYYYYMM() {
            try {
                const s = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
                return s.length >= 7 ? s.slice(0, 7) : new Date().toISOString().slice(0, 7);
            } catch (e) {
                return new Date().toISOString().slice(0, 7);
            }
        }

        async function loadPointsRanking() {
            const rankListEl = document.getElementById('points-ranking-list');
            const myRankBadge = document.getElementById('points-my-rank-badge');
            const rankCard = document.getElementById('points-ranking-card');
            if (!rankListEl || !rankCard) return;
            const _rkRole = String(currentUser?.role || '').trim();
            const canSeeRanking = _rkRole === ROLES.ADMIN || _rkRole === ROLES.HQ_MANAGER || _rkRole === ROLES.HR_MANAGER || _rkRole === ROLES.STORE_MANAGER;
            if (!canSeeRanking) { rankCard.style.display = 'none'; return; }
            rankCard.style.display = '';
            try {
                const store = (_rkRole === ROLES.STORE_MANAGER) ? String(currentUser?.store || '').trim() : '';
                const month = hrmsShanghaiYYYYMM();
                const data = await HRMS_API.getPointsRanking({ month, store });
                const ranking = Array.isArray(data?.ranking) ? data.ranking : [];

                if (myRankBadge && data.myRank) {
                    myRankBadge.style.display = '';
                    myRankBadge.textContent = '我的排名：第' + data.myRank + '名';
                } else if (myRankBadge) {
                    myRankBadge.style.display = 'none';
                }

                if (!ranking.length) {
                    rankListEl.innerHTML = '<div style="color:rgba(200,215,230,0.6); font-size:12px; padding:8px 0;">本月暂无积分数据</div>';
                    return;
                }

                const myUsername = String(currentUser?.username || '').trim().toLowerCase();
                rankListEl.innerHTML = ranking.slice(0, 30).map(item => {
                    const isMe = item.username === myUsername;
                    const rankNum = item.rank;
                    let medal = '';
                    if (rankNum === 1) medal = '🥇';
                    else if (rankNum === 2) medal = '🥈';
                    else if (rankNum === 3) medal = '🥉';
                    const bgStyle = isMe ? 'background:rgba(201,169,106,0.12); border:1px solid rgba(201,169,106,0.3);' : 'background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06);';
                    const nameColor = isMe ? 'color:rgba(254,240,138,0.95); font-weight:800;' : 'color:rgba(226,232,240,0.92);';
                    const rankColor = rankNum <= 3 ? 'color:#c9a96a; font-weight:900;' : 'color:rgba(200,215,230,0.7); font-weight:700;';
                    return `<div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:10px; margin-bottom:4px; ${bgStyle}">
                        <div style="min-width:28px; text-align:center; font-size:${rankNum <= 3 ? '18px' : '14px'}; ${rankColor}">${medal || rankNum}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:13px; ${nameColor} white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(item.name || item.username)}${isMe ? ' <span style="font-size:10px; opacity:0.7;">(我)</span>' : ''}</div>
                            ${(item.position || item.store) ? '<div style="font-size:10px; color:rgba(200,215,230,0.5); margin-top:1px;">' + escapeHtml([item.position, item.store].filter(Boolean).join(' · ')) + '</div>' : ''}
                        </div>
                        <div style="font-size:15px; font-weight:900; color:${rankNum <= 3 ? '#c9a96a' : 'rgba(245,158,11,0.9)'}; text-shadow:0 1px 4px rgba(201,169,106,0.2);">${item.totalPoints}<span style="font-size:10px; font-weight:500; opacity:0.7;">分</span></div>
                    </div>`;
                }).join('');
            } catch (e) {
                rankListEl.innerHTML = '<div style="color:rgba(200,215,230,0.5); font-size:12px;">排行榜加载失败' + (e && e.message ? '（' + escapeHtml(String(e.message)) + '）' : '') + '</div>';
                console.warn('loadPointsRanking error:', e);
            }
        }

        async function queryPointsAdminRecords() {
            const listEl = document.getElementById('points-records-list');
            const monthPointsEl = document.getElementById('points-month-points');
            const monthAmountEl = document.getElementById('points-month-amount');
            const recordsTitleEl = document.getElementById('points-records-title');
            if (!listEl) return;
const role = String(currentUser?.role || '').trim();
             const isStoreManagerView = role === ROLES.STORE_MANAGER;
             const isAdminView = role === ROLES.ADMIN || role === ROLES.HR_MANAGER || role === ROLES.HQ_MANAGER;
             const storeSel = document.getElementById('points-admin-store');
             const selectedStore = String(storeSel?.value || '').trim();
             const store = isStoreManagerView ? String(currentUser?.store || '').trim() : selectedStore;
            const storeLabel = (() => {
                if (isStoreManagerView) return String(currentUser?.store || '').trim() || '本门店';
                if (!storeSel || storeSel.disabled) return store || '—';
                const t = String(storeSel.options[storeSel.selectedIndex]?.textContent || '').trim();
                return t || '—';
            })();
            const name = String(document.getElementById('points-admin-name')?.value || '').trim();
            const start = String(document.getElementById('points-admin-start')?.value || '').trim();
            const end = String(document.getElementById('points-admin-end')?.value || '').trim();
            const recordStatus = String(document.getElementById('points-admin-record-status')?.value || 'approved').trim() || 'approved';
            try {
                listEl.innerHTML = '<div style="color:rgba(200,215,230,0.75);">加载中...</div>';
                const resp = await HRMS_API.getPointRecords({ store, name, start, end, recordStatus });
                const items = Array.isArray(resp?.items) ? resp.items : [];
                const sm = resp?.summary && typeof resp.summary === 'object' ? resp.summary : null;
                const sumPts = sm && Number.isFinite(Number(sm.totalPoints)) ? Number(sm.totalPoints) : items.reduce((s, x) => s + (Number(x?.points || 0) || 0), 0);
                const sumAmt = sm && Number.isFinite(Number(sm.totalAmount)) ? Number(sm.totalAmount) : Number((sumPts * 0.5).toFixed(2));
                const sumCnt = sm && Number.isFinite(Number(sm.recordCount)) ? Number(sm.recordCount) : items.length;
                const sumPeople = sm && Number.isFinite(Number(sm.employeeCount)) ? Number(sm.employeeCount) : new Set(items.map(x => String(x?.username || '').trim().toLowerCase()).filter(Boolean)).size;
                const sumBox = document.getElementById('points-admin-query-summary');
                const sp = document.getElementById('points-admin-sum-points');
                const sa = document.getElementById('points-admin-sum-amount');
                const sc = document.getElementById('points-admin-sum-count');
                const spe = document.getElementById('points-admin-sum-people');
                const sStore = document.getElementById('points-admin-sum-store');
                if (sumBox) sumBox.style.display = '';
                if (sp) sp.textContent = String(sumPts);
                if (sa) sa.textContent = '¥' + sumAmt.toFixed(2);
                if (sc) sc.textContent = String(sumCnt);
                if (spe) spe.textContent = String(sumPeople);
                if (sStore) sStore.textContent = storeLabel;
                if (recordsTitleEl && (isAdminView || isStoreManagerView)) {
                    recordsTitleEl.textContent = storeLabel && storeLabel !== '全部门店' ? `积分记录（${storeLabel}）` : '积分记录（全部门店）';
                }
                const nowMonth = hrmsShanghaiYYYYMM();
                const monthPoints = items
                    .filter(x => String(x?.approvedAt || x?.createdAt || '').slice(0, 7) === nowMonth)
                    .reduce((s, x) => s + (Number(x?.points || 0) || 0), 0);
                if (monthPointsEl) monthPointsEl.textContent = String(monthPoints);
                if (monthAmountEl) monthAmountEl.textContent = '¥' + Number(monthPoints * 0.5).toFixed(2);

                if (!items.length) {
                    listEl.innerHTML = '<div style="color:rgba(200,215,230,0.75);">暂无匹配记录</div>';
                    return;
                }
                const grouped = new Map();
                for (const it of items) {
                    const username = String(it?.username || '').trim().toLowerCase();
                    const who = String(it?.name || it?.username || '-').trim();
                    const key = username || who;
                    if (!grouped.has(key)) {
                        grouped.set(key, {
                            username,
                            name: who,
                            store: String(it?.store || '').trim(),
                            items: [],
                            totalPoints: 0,
                            totalAmount: 0
                        });
                    }
                    const group = grouped.get(key);
                    group.items.push(it);
                    group.totalPoints += Number(it?.points || 0) || 0;
                    group.totalAmount += Number(it?.amount || ((Number(it?.points || 0) || 0) * 0.5)) || 0;
                    if (!group.store && it?.store) group.store = String(it.store || '').trim();
                }
                const groupedList = Array.from(grouped.values()).sort((a, b) => {
                    const byStore = String(a.store || '').localeCompare(String(b.store || ''), 'zh-Hans-CN');
                    if (byStore !== 0) return byStore;
                    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
                });
                listEl.innerHTML = groupedList.map(group => {
                    const stSet = new Set((Array.isArray(group.items) ? group.items : []).map(x => String(x?.store || '').trim()).filter(Boolean));
                    const gStoreLabel = stSet.size <= 1 ? (group.store || [...stSet][0] || '—') : ([...stSet].slice(0, 2).join('、') + (stSet.size > 2 ? ' 等' + stSet.size + '店' : ''));
                    const rows = (Array.isArray(group.items) ? group.items : [])
                        .slice()
                        .sort((a, b) => String(b?.approvedAt || b?.createdAt || '').localeCompare(String(a?.approvedAt || a?.createdAt || '')))
                        .map(it => {
                            const itemName = String(it?.itemName || '积分事项').trim();
                            const pts = Number(it?.points || 0);
                            const amount = Number(it?.amount || (pts * 0.5));
                            const dt = String(it?.approvedAt || it?.createdAt || '').slice(0, 19).replace('T', ' ');
                            const aid = String(it?.approvalId || it?.id || '').trim();
                            const rowStore = String(it?.store || '').trim() || '—';
                            const st = String(it?.recordStatusZh || '已审批').trim();
                            return `<details class="rep-row-details">
                                <summary class="rep-row-details__summary" style="align-items:flex-start;">
                                    <span class="rep-row-details__sum-main">
                                        <span class="rep-row-details__sum-title">${escapeHtml(itemName)} · ${pts}分</span>
                                        <span class="rep-row-details__sum-meta">门店：${escapeHtml(rowStore)} · 状态：${escapeHtml(st)}${dt ? ' · ' + escapeHtml(dt) : ''}</span>
                                    </span>
                                    <span style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                                        <span class="rep-row-details__sum-badge" style="color:#f59e0b;">¥${amount.toFixed(2)}</span>
                                        <span class="rep-row-details__chev" aria-hidden="true">▼</span>
                                    </span>
                                </summary>
                                <div class="rep-row-details__body">
                                    ${aid ? `<button class="btn btn-secondary" type="button" style="padding:6px 10px; font-size:12px;" onclick="event.stopPropagation(); openApprovalDetailModal('${escapeHtml(aid)}')">查看审批详情</button>` : '<div style="font-size:12px;color:rgba(200,215,230,0.6);">无关联审批单</div>'}
                                </div>
                            </details>`;
                        }).join('');
                    return `<div style="padding:12px; border-radius:16px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02); margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center;">
                            <div>
                                <div style="font-weight:900; color:rgba(226,232,240,0.96); font-size:16px;">${escapeHtml(group.name || group.username || '-')}</div>
                                <div style="margin-top:4px; font-size:12px; color:rgba(200,215,230,0.7);">门店：${escapeHtml(gStoreLabel)} · ${group.items.length}条记录</div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:13px; color:#c9a96a; font-weight:900;">${Number(group.totalPoints || 0)}分</div>
                                <div style="margin-top:4px; font-size:12px; color:#f59e0b; font-weight:800;">¥${Number(group.totalAmount || 0).toFixed(2)}</div>
                            </div>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">${rows}</div>
                    </div>`;
                }).join('');
            } catch (e) {
                listEl.innerHTML = '<div style="color:#ef4444;">加载失败：' + escapeHtml(String(e?.message || e)) + '</div>';
                try { const sumBox = document.getElementById('points-admin-query-summary'); if (sumBox) sumBox.style.display = 'none'; } catch (_e) {}
            }
        }

        function closeApprovalDetailModal() {
            const modal = document.getElementById('approval-detail-modal');
            if (modal) modal.classList.remove('show');
            __CURRENT_APPROVAL = null;
        }

        async function openApprovalDetailModal(id) {
            const key = String(id || '').trim();
            let item = (__APPROVALS_CACHE || []).find(x => String(x?.id || '') === key) || null;
            if (!item) {
                item = (__REWARDS_APPROVALS_CACHE || []).find(x => String(x?.id || '') === key) || null;
            }
            if (!item && key) {
                try {
                    const one = await HRMS_API.getApproval(key);
                    if (one && one.item && String(one.item.id || '') === key) {
                        item = one.item;
                        const merged = [item, ...(__APPROVALS_CACHE || []).filter(x => String(x?.id || '') !== key)];
                        __APPROVALS_CACHE = merged;
                    }
                } catch (e) {}
            }
            if (!item) {
                // Try fetching fresh from server to handle stale cache
                try {
                    const candidates = [];
                    try {
                        const allResp = await HRMS_API.getApprovals({ view: 'all', type: 'reward_punishment', status: '', limit: 500 });
                        candidates.push(...(Array.isArray(allResp?.items) ? allResp.items : []));
                    } catch (e) {}
                    try {
                        const createdResp = await HRMS_API.getApprovals({ view: 'created', type: 'reward_punishment', status: '', limit: 500 });
                        candidates.push(...(Array.isArray(createdResp?.items) ? createdResp.items : []));
                    } catch (e) {}
                    try {
                        const ptsAll = await HRMS_API.getApprovals({ view: 'all', type: 'points', status: '', limit: 200 });
                        candidates.push(...(Array.isArray(ptsAll?.items) ? ptsAll.items : []));
                    } catch (e) {}
                    try {
                        const ptsCreated = await HRMS_API.getApprovals({ view: 'created', type: 'points', status: '', limit: 200 });
                        candidates.push(...(Array.isArray(ptsCreated?.items) ? ptsCreated.items : []));
                    } catch (e) {}
                    if (!candidates.length) {
                        const fallbackResp = await HRMS_API.getApprovals({ status: '', limit: 500 });
                        candidates.push(...(Array.isArray(fallbackResp?.items) ? fallbackResp.items : []));
                    }
                    const byId = new Map();
                    for (const c of candidates) {
                        const cid = String(c?.id || '');
                        if (cid) byId.set(cid, c);
                    }
                    item = byId.get(key) || null;
                    if (candidates.length) {
                        __APPROVALS_CACHE = Array.from(byId.values());
                        __REWARDS_APPROVALS_CACHE = __APPROVALS_CACHE.filter(x => String(x?.type || '') === 'reward_punishment');
                    }
                } catch (e) {}
            }
            if (!item) {
                showNotification('未找到该审批记录，可能已被删除。正在刷新列表...', 'warning');
                try { loadApprovals(); } catch (e) {}
                return;
            }
            __CURRENT_APPROVAL = item;
            const modal = document.getElementById('approval-detail-modal');
            const body = document.getElementById('approval-detail-body');
            const sub = document.getElementById('approval-detail-subtitle');
            if (!modal || !body) return;

            const type = approvalTypeText(item?.type);
            const rawStatus = String(item?.status || '').trim();
            const st = (String(item?.type || '') === 'payment' && rawStatus === 'approved') ? '已审核' : approvalStatusText(rawStatus);
            const who = String(item?.applicant_name || '').trim() || hrmsDisplayName(item?.applicant_username);
            const createdAt = toBeijingTime(item?.created_at || item?.createdAt || '');
            if (sub) sub.textContent = `${type} · ${st} · ${createdAt}${who !== '-' ? (' · 申请人 ' + who) : ''}`;

            const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
            const chain = Array.isArray(item?.chain) ? item.chain : [];
            const chainHtml = chain.map(s => {
                const step = String(s?.step || '');
                const assignee = String(s?.assignee || '').trim();
                const status = String(s?.status || '').trim();
                const statusText = status === 'pending' ? '待处理' : (status === 'queued' ? '排队' : (status === 'approved' ? '通过' : (status === 'rejected' ? '拒绝' : status)));
                const note = String(s?.note || '').trim();
                const time = toBeijingTime(s?.decidedAt || '');
                return `<div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <div style="display:flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                        <div style="font-weight: 800;">第 ${escapeHtml(step)} 步：${escapeHtml(String(s?.assignee_name || '').trim() || hrmsDisplayName(assignee))}</div>
                        <div style="font-weight: 800; color: rgba(226,232,240,0.95);">${escapeHtml(statusText || '-')}</div>
                    </div>
                    ${note ? `<div style="margin-top: 6px; color: rgba(200,215,230,0.85); font-size: 12px;">备注：${escapeHtml(note)}</div>` : ''}
                    ${time ? `<div style="margin-top: 4px; color: rgba(200,215,230,0.65); font-size: 12px;">时间：${escapeHtml(time)}</div>` : ''}
                </div>`;
            }).join('');

            let payloadHtml = '';
            if (String(item?.type || '') === 'onboarding') {
                const emp = payload?.employee && typeof payload.employee === 'object' ? payload.employee : {};
                payloadHtml = `
                    <div style="margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);">
                        <div style="font-weight: 900;">员工信息</div>
                        <div style="margin-top: 10px; display:grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            <div style="color: rgba(200,215,230,0.85);">姓名：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(emp?.name || '-')}</span></div>
                            <div style="color: rgba(200,215,230,0.85);">门店：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(emp?.store || '-')}</span></div>
                            <div style="color: rgba(200,215,230,0.85);">岗位：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(emp?.position || '-')}</span></div>
                            <div style="color: rgba(200,215,230,0.85);">部门：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(emp?.department || '-')}</span></div>
                            <div style="color: rgba(200,215,230,0.85);">入职：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(emp?.joinDate || '-')}</span></div>
                            <div style="color: rgba(200,215,230,0.85);">工资：<span style="color: rgba(59,130,246,0.95); font-weight: 900;">${emp?.salary != null && emp.salary !== '' ? '¥' + escapeHtml(String(emp.salary)) : '-'}</span></div>
                        </div>
                    </div>
                `;
                if (String(item?.status || '') === 'returned' && String(currentUser?.username || '').toLowerCase() === String(item?.applicant_username || '').toLowerCase()) {
                    const _obRnHtml = String(payload?.returnNote||'').trim() ? '<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;font-size:12px;color:rgba(253,186,116,0.9);">退回原因：' + escapeHtml(String(payload.returnNote).trim()) + '</div>' : '';
                    const _obRolesOpts = (_edRoles||[]).map(r => '<option value="' + escapeHtml(r.c) + '"' + (r.c === (emp?.role||'') ? ' selected' : '') + '>' + escapeHtml(r.l) + '</option>').join('');
                    payloadHtml += '<div id="onboarding-ret-edit" style="margin-top:14px;padding:12px;border-radius:12px;border:1px solid rgba(94,234,212,0.35);background:rgba(94,234,212,0.06);">'
                        + '<div style="font-weight:800;color:#5eead4;margin-bottom:6px;">修改入职信息</div>'
                        + _obRnHtml
                        + '<div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:10px;">可修改填错的字段，无需变动的保持原值即可。</div>'
                        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
                        + '<div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">姓名</div><input id="ob-ret-name" class="form-input" value="' + escapeHtml(emp?.name||'') + '"></div>'
                        + '<div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">门店</div><input id="ob-ret-store" class="form-input" value="' + escapeHtml(emp?.store||'') + '"></div>'
                        + '<div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">岗位</div><input id="ob-ret-position" class="form-input" value="' + escapeHtml(emp?.position||'') + '"></div>'
                        + '<div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">部门</div><input id="ob-ret-department" class="form-input" value="' + escapeHtml(emp?.department||'') + '"></div>'
                        + '<div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">角色</div><select id="ob-ret-role" class="form-input">' + _obRolesOpts + '</select></div>'
                        + '<div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">级别</div><input id="ob-ret-level" class="form-input" value="' + escapeHtml(emp?.level||'') + '"></div>'
                        + '<div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">直属上级账号</div><input id="ob-ret-managerUsername" class="form-input" value="' + escapeHtml(emp?.managerUsername||'') + '"></div>'
                        + '<div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">入职日期</div><input id="ob-ret-joinDate" type="date" class="form-input" value="' + escapeHtml(emp?.joinDate||'') + '"></div>'
                        + '<div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">工资</div><input id="ob-ret-salary" type="number" class="form-input" value="' + (emp?.salary!=null&&emp.salary!==''?escapeHtml(String(emp.salary)):'') + '"></div>'
                        + '<div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">手机号</div><input id="ob-ret-phone" class="form-input" value="' + escapeHtml(emp?.phone||'') + '"></div>'
                        + '</div></div>';
                }
            } else if (String(item?.type || '') === 'promotion') {
                const stage = String(payload?.promotionStage || 'qualification').trim().toLowerCase();
                const stageText = stage === 'formal' ? '正式晋升' : '晋升资格';
                const typeText = String(payload?.promotionType || '') === 'same'
                    ? '同岗位晋升'
                    : (String(payload?.promotionType || '') === 'cross' ? '跨岗位晋升' : '-');
                const capabilityText = String(payload?.capabilityRequirements || '').trim();
                const promotedSalary = Number(payload?.promotedSalary);
                const promotedSalaryText = Number.isFinite(promotedSalary) && promotedSalary > 0
                    ? ('¥' + promotedSalary.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                    : '';
                payloadHtml = `
                    <div style="margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);">
                        <div style="font-weight: 900;">晋升申请信息</div>
                        <div style="margin-top: 10px; color: rgba(200,215,230,0.85);">阶段：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(stageText)}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">类型：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(typeText)}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">当前岗位/级别：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(String(payload?.currentPosition || '-'))} / ${escapeHtml(String(payload?.currentLevel || '-'))}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">目标岗位/级别：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(String(payload?.targetPosition || payload?.newPosition || '-'))} / ${escapeHtml(String(payload?.targetLevel || payload?.newLevel || '-'))}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">申请理由：<div style="margin-top: 6px; color: rgba(226,232,240,0.95);">${escapeHtml(String(payload?.reason || '-'))}</div></div>
                        ${promotedSalaryText ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">晋升后薪资：<span style="color:#22c55e; font-weight:900;">${escapeHtml(promotedSalaryText)}</span></div>` : ''}
                        ${capabilityText ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">能力要求：<div style="margin-top: 6px; color: rgba(226,232,240,0.95); white-space: pre-wrap;">${escapeHtml(capabilityText)}</div></div>` : ''}
                    </div>
                    <div id="promotion-mentor-box" style="margin-top:12px; padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(59,130,246,0.06); display:none;">
                        <div style="font-weight:900; font-size:13px; color:rgba(226,232,240,0.95); margin-bottom:8px;">店长审批通过时，请指定带教人与培训周期</div>
                        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
                            <div>
                                <div style="font-size:12px; color:rgba(200,215,230,0.78); margin-bottom:4px;">带教人 *</div>
                                <select id="promotion-mentor-username-input" class="form-input" data-selected="${escapeHtml(String(payload?.mentorUsername || ''))}"><option value="">请选择带教人</option></select>
                            </div>
                            <div>
                                <div style="font-size:12px; color:rgba(200,215,230,0.78); margin-bottom:4px;">带教人姓名</div>
                                <input id="promotion-mentor-name-input" class="form-input" placeholder="选择带教人后自动填充" value="${escapeHtml(String(payload?.mentorName || ''))}" readonly>
                            </div>
                            <div>
                                <div style="font-size:12px; color:rgba(200,215,230,0.78); margin-bottom:4px;">培训开始日期 *</div>
                                <input id="promotion-training-start-input" type="date" class="form-input" value="${escapeHtml(String(payload?.trainingStartDate || ''))}">
                            </div>
                            <div>
                                <div style="font-size:12px; color:rgba(200,215,230,0.78); margin-bottom:4px;">培训周期（天）</div>
                                <input id="promotion-training-days-input" type="number" min="1" max="30" class="form-input" value="${escapeHtml(String(payload?.trainingDays || 3))}">
                            </div>
                        </div>
                        <div style="margin-top:10px; border-top:1px dashed rgba(255,255,255,0.12); padding-top:10px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px;">
                                <div style="font-size:12px; color:rgba(200,215,230,0.78);">灵活培训周期（选择日期 + 输入内容）*</div>
                                <button type="button" class="btn btn-secondary" style="padding:6px 10px; font-size:12px;" onclick="promoAddTrainingPeriodRow()">+ 添加周期</button>
                            </div>
                            <div id="promotion-training-periods-editor" style="display:grid; gap:8px;"></div>
                            <div style="margin-top:6px; font-size:11px; color:rgba(200,215,230,0.62);">无需手输日期格式，直接选择开始/结束日期；内容可自由输入。</div>
                        </div>
                    </div>
                    <div id="promotion-salary-box" style="margin-top:12px; padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(34,197,94,0.08); display:none;">
                        <div style="font-weight:900; font-size:13px; color:rgba(226,232,240,0.95); margin-bottom:8px;">店长审批正式晋升时，请填写晋升后薪资 *</div>
                        <input id="promotion-promoted-salary-input" type="number" min="1" step="0.01" class="form-input" value="${escapeHtml(String(payload?.promotedSalary || ''))}" placeholder="请输入晋升后薪资，例如 6800">
                        <div style="margin-top:6px; font-size:11px; color:rgba(200,215,230,0.62);">总部营运与总部人事将审批该金额，通过后自动更新到员工薪资。</div>
                    </div>
                `;
                if (String(item?.status || '') === 'returned' && String(currentUser?.username || '').toLowerCase() === String(item?.applicant_username || '').toLowerCase()) {
                    const _promoRnHtml = String(payload?.returnNote||'').trim() ? '<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;font-size:12px;color:rgba(253,186,116,0.9);">退回原因：' + escapeHtml(String(payload.returnNote).trim()) + '</div>' : '';
                    payloadHtml += `<div id="promotion-ret-edit" style="margin-top:14px;padding:12px;border-radius:12px;border:1px solid rgba(99,102,241,0.35);background:rgba(99,102,241,0.06);">
                        <div style="font-weight:800;color:#a5b4fc;margin-bottom:6px;">修改晋升申请</div>
                        ${_promoRnHtml}
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;">
                            <div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">目标岗位</div><input data-field="targetPosition" class="form-input promo-ret-field" value="${escapeHtml(payload?.targetPosition||payload?.newPosition||'')}"></div>
                            <div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">目标级别</div><input data-field="targetLevel" class="form-input promo-ret-field" value="${escapeHtml(payload?.targetLevel||payload?.newLevel||'')}"></div>
                        </div>
                        <div style="margin-top:10px;"><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">申请理由</div><textarea data-field="reason" class="form-input promo-ret-field" rows="3" style="resize:vertical;">${escapeHtml(payload?.reason||'')}</textarea></div>
                    </div>`;
                }
            } else if (String(item?.type || '') === 'offboarding') {
                const existingDepType = String(payload?.departureType || '').trim();
                const depTypeDisplay = existingDepType === 'voluntary' ? '主动离职（辞职）' : existingDepType === 'involuntary' ? '被动离职（劝退/裁员）' : '';
                const depTypeColor = existingDepType === 'voluntary' ? '#ea580c' : existingDepType === 'involuntary' ? '#7c3aed' : '';
                const offbApplicantRec = hrmsLookupUserRecord(item?.applicant_username);
                const offbApplicantName = hrmsDisplayName(item?.applicant_username);
                const offbApplicantPosition = String(offbApplicantRec?.position || '').trim();
                const offbApplicantLevel = String(offbApplicantRec?.level || '').trim();
                const offbApplicantStore = String(offbApplicantRec?.store || '').trim();
                payloadHtml = `
                    <div style="margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);">
                        <div style="font-weight: 900;">离职信息</div>
                        <div style="margin-top: 10px; color: rgba(200,215,230,0.85);">申请人：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(offbApplicantName || '-')}</span></div>
                        ${offbApplicantStore ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">门店：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(offbApplicantStore)}</span></div>` : ''}
                        ${offbApplicantPosition ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">岗位：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(offbApplicantPosition)}</span></div>` : ''}
                        ${offbApplicantLevel ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">级别：<span style="color: rgba(139,92,246,0.95); font-weight: 800;">${escapeHtml(offbApplicantLevel)}</span></div>` : ''}
                        <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; color: rgba(200,215,230,0.85);">离职日：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.resignDate || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">原因：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.reason || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">说明：<div style="margin-top: 6px; color: rgba(226,232,240,0.95);">${escapeHtml(payload?.detail || '')}</div></div>
                        ${depTypeDisplay ? `<div style="margin-top: 10px; color: rgba(200,215,230,0.85);">离职类型：<span style="color: ${depTypeColor}; font-weight: 900;">${escapeHtml(depTypeDisplay)}</span></div>` : ''}
                    </div>
                    <div id="offboarding-departure-type-box" style="margin-top: 12px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); background: rgba(234,88,12,0.06);">
                        <div style="font-weight: 900; font-size: 13px; color: rgba(226,232,240,0.95); margin-bottom: 8px;">⚠️ 请确认离职类型<span style="font-size:11px; color:rgba(200,215,230,0.6); font-weight:400; margin-left:6px;">（审批通过时将记录此分类）</span></div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            <button type="button" class="btn btn-secondary offb-dep-type-btn" data-dep-type="voluntary" onclick="selectOffbDepType('voluntary')" style="flex:1; padding:10px 12px; border-radius:10px; font-size:13px; font-weight:700; border:2px solid transparent; min-width:120px;">
                                🙋 主动离职<div style="font-size:10px; font-weight:400; margin-top:2px; color:rgba(200,215,230,0.6);">员工辞职</div>
                            </button>
                            <button type="button" class="btn btn-secondary offb-dep-type-btn" data-dep-type="involuntary" onclick="selectOffbDepType('involuntary')" style="flex:1; padding:10px 12px; border-radius:10px; font-size:13px; font-weight:700; border:2px solid transparent; min-width:120px;">
                                📋 被动离职<div style="font-size:10px; font-weight:400; margin-top:2px; color:rgba(200,215,230,0.6);">劝退/裁员</div>
                            </button>
                        </div>
                    </div>
                `;
                if (String(item?.status || '') === 'returned' && String(currentUser?.username || '').toLowerCase() === String(item?.applicant_username || '').toLowerCase()) {
                    const _offbRnHtml = String(payload?.returnNote||'').trim() ? '<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;font-size:12px;color:rgba(253,186,116,0.9);">退回原因：' + escapeHtml(String(payload.returnNote).trim()) + '</div>' : '';
                    payloadHtml += `<div id="offboarding-ret-edit" style="margin-top:14px;padding:12px;border-radius:12px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.06);">
                        <div style="font-weight:800;color:#fca5a5;margin-bottom:6px;">修改离职申请</div>
                        ${_offbRnHtml}
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;">
                            <div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">离职日期</div><input data-field="resignDate" type="date" class="form-input offb-ret-field" value="${escapeHtml(payload?.resignDate||'')}"></div>
                            <div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">离职原因</div><input data-field="reason" class="form-input offb-ret-field" value="${escapeHtml(payload?.reason||'')}"></div>
                        </div>
                        <div style="margin-top:10px;"><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">说明</div><textarea data-field="detail" class="form-input offb-ret-field" rows="2" style="resize:vertical;">${escapeHtml(payload?.detail||'')}</textarea></div>
                    </div>`;
                }
            } else if (String(item?.type || '') === 'leave') {
                const existingRemDays = payload?.remainingLeaveDays;
                const existingRemDaysDisplay = (existingRemDays != null && existingRemDays !== '') ? String(existingRemDays) : '';
                const managerFilledBy = String(payload?.remainingLeaveDaysFilledBy || '').trim();
                const leaveApplicantName = hrmsDisplayName(item?.applicant_username);
                const leaveApplicantRec = hrmsLookupUserRecord(item?.applicant_username);
                const leaveApplicantStore = String(leaveApplicantRec?.store || payload?.store || '').trim();
                const leaveApplicantPosition = String(leaveApplicantRec?.position || payload?.position || '').trim();
                const leaveApplicantLevel = String(leaveApplicantRec?.level || payload?.level || '').trim();
                payloadHtml = `
                    <div style="margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);">
                        <div style="font-weight: 900;">休假信息</div>
                        <div style="margin-top: 10px; color: rgba(200,215,230,0.85);">申请人：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(leaveApplicantName || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">门店：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(leaveApplicantStore || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">岗位：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(leaveApplicantPosition || '-')}</span></div>
                        ${leaveApplicantLevel ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">级别：<span style="color: rgba(139,92,246,0.95); font-weight: 800;">${escapeHtml(leaveApplicantLevel)}</span></div>` : ''}
                        <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; color: rgba(200,215,230,0.85);">休假类型：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.leaveType || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">开始日期：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.startDate || payload?.fromDate || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">结束日期：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.endDate || payload?.toDate || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">原因：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.reason || payload?.leaveReason || '-')}</span></div>
                        ${existingRemDaysDisplay ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">剩余休假天数（审批环节填写${managerFilledBy ? '：' + escapeHtml(hrmsDisplayName(managerFilledBy)) : ''}）：<span style="color: rgba(59,130,246,0.95); font-weight: 900;">${escapeHtml(existingRemDaysDisplay)} 天</span></div>` : ''}
                    </div>
                    <div id="leave-remaining-days-box" style="margin-top: 12px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); background: rgba(59,130,246,0.06); display:none;">
                        <div style="font-weight: 900; font-size: 13px; color: rgba(226,232,240,0.95); margin-bottom: 8px;" id="leave-remaining-days-title"></div>
                        <input id="leave-remaining-days-input" type="number" step="0.5" class="form-input" style="max-width: 200px;" placeholder="请输入天数（可为负）" value="${escapeHtml(existingRemDaysDisplay)}" />
                        <div style="margin-top: 6px; font-size: 11px; color: rgba(200,215,230,0.6);" id="leave-remaining-days-hint"></div>
                    </div>
                `;
                if (String(item?.status || '') === 'returned' && String(currentUser?.username || '').toLowerCase() === String(item?.applicant_username || '').toLowerCase()) {
                    const _leaveRnHtml = String(payload?.returnNote||'').trim() ? '<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;font-size:12px;color:rgba(253,186,116,0.9);">退回原因：' + escapeHtml(String(payload.returnNote).trim()) + '</div>' : '';
                    payloadHtml += `<div id="leave-ret-edit" style="margin-top:14px;padding:12px;border-radius:12px;border:1px solid rgba(59,130,246,0.35);background:rgba(59,130,246,0.06);">
                        <div style="font-weight:800;color:#93c5fd;margin-bottom:6px;">修改休假申请</div>
                        ${_leaveRnHtml}
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;">
                            <div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">开始日期</div><input data-field="startDate" type="date" class="form-input leave-ret-field" value="${escapeHtml(payload?.startDate||payload?.fromDate||'')}"></div>
                            <div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">结束日期</div><input data-field="endDate" type="date" class="form-input leave-ret-field" value="${escapeHtml(payload?.endDate||payload?.toDate||'')}"></div>
                        </div>
                        <div style="margin-top:10px;"><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">休假原因</div><textarea data-field="reason" class="form-input leave-ret-field" rows="2" style="resize:vertical;">${escapeHtml(payload?.reason||payload?.leaveReason||'')}</textarea></div>
                    </div>`;
                }
            } else if (String(item?.type || '') === 'reward_punishment') {
                const rpType = String(payload?.rpType || payload?.category || '').trim();
                const rpLabel = (rpType === '奖励' || rpType === 'reward') ? '奖励' : '惩罚';
                const amt = Number(payload?.amount || 0);
                const amountText = Number.isFinite(amt) ? ('¥' + Math.abs(amt).toLocaleString('zh-CN', { maximumFractionDigits: 2 })) : '¥0.00';
                const createdAtText = toBeijingTime(item?.created_at || item?.createdAt || '') || '-';
                const effectiveAtText = String(item?.effective_date || '').slice(0, 10) || '-';
                const rpTargetRec = hrmsLookupUserRecord(payload?.targetUsername);
                const rpTargetLevel = String(rpTargetRec?.level || '').trim();
                const rpTargetPosition = String(rpTargetRec?.position || '').trim();
                payloadHtml = `
                    <div style="margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);">
                        <div style="font-weight: 900;">奖惩信息</div>
                        <div style="margin-top: 10px; color: rgba(200,215,230,0.85);">类型：<span style="color: ${rpLabel === '奖励' ? 'rgba(34,197,94,0.95)' : 'rgba(239,68,68,0.95)'}; font-weight: 900;">${escapeHtml(rpLabel)}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">受奖罚人：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.targetName || payload?.targetUsername || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">账号：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.targetUsername || '-')}</span></div>
                        ${rpTargetPosition ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">岗位：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(rpTargetPosition)}</span></div>` : ''}
                        ${rpTargetLevel ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">级别：<span style="color: rgba(139,92,246,0.95); font-weight: 800;">${escapeHtml(rpTargetLevel)}</span></div>` : ''}
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">门店：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.store || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">提报时间：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(createdAtText)}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">生效日期：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(effectiveAtText)}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">事由：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.reason || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">结果：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.result || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">薪资影响：<span style="color: ${rpLabel === '奖励' ? 'rgba(34,197,94,0.95)' : 'rgba(239,68,68,0.95)'}; font-weight: 900;">${escapeHtml(amountText)}</span></div>
                        ${payload?.note ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">备注：<div style="margin-top: 6px; color: rgba(226,232,240,0.95);">${escapeHtml(payload?.note || '')}</div></div>` : ''}
                    </div>
                `;
                if (String(item?.status || '') === 'returned' && String(currentUser?.username || '').toLowerCase() === String(item?.applicant_username || '').toLowerCase()) {
                    const _rpRnHtml = String(payload?.returnNote||'').trim() ? '<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;font-size:12px;color:rgba(253,186,116,0.9);">退回原因：' + escapeHtml(String(payload.returnNote).trim()) + '</div>' : '';
                    payloadHtml += `<div id="rp-ret-edit" style="margin-top:14px;padding:12px;border-radius:12px;border:1px solid rgba(234,179,8,0.35);background:rgba(234,179,8,0.06);">
                        <div style="font-weight:800;color:#fde68a;margin-bottom:6px;">修改奖惩申请</div>
                        ${_rpRnHtml}
                        <div style="margin-top:8px;"><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">事由</div><textarea data-field="reason" class="form-input rp-ret-field" rows="2" style="resize:vertical;">${escapeHtml(payload?.reason||'')}</textarea></div>
                        <div style="margin-top:10px;"><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">结果</div><textarea data-field="result" class="form-input rp-ret-field" rows="2" style="resize:vertical;">${escapeHtml(payload?.result||'')}</textarea></div>
                    </div>`;
                }
            } else if (String(item?.type || '') === 'points') {
                const pts = Number(payload?.points || 0);
                const amount = Number((pts * 0.5).toFixed(2));
                const evidences = Array.isArray(payload?.evidenceUrls) ? payload.evidenceUrls : [];
                const base = String(HRMS_API.baseUrl ? HRMS_API.baseUrl() : '').replace(/\/$/, '');
                const toAbs = (u) => {
                    const s = String(u || '').trim();
                    if (!s) return '';
                    if (/^https?:\/\//i.test(s)) return s;
                    if (!base) return s;
                    return s.startsWith('/') ? (base + s) : (base + '/' + s);
                };
                const pointsApplicantRec = hrmsLookupUserRecord(item?.applicant_username);
                const pointsApplicantName = String(payload?.applicantName || '').trim() || hrmsDisplayName(item?.applicant_username);
                const pointsApplicantPosition = String(payload?.applicantPosition || '').trim() || String(pointsApplicantRec?.position || '').trim();
                const pointsApplicantDept = String(payload?.applicantDepartment || '').trim() || String(pointsApplicantRec?.department || '').trim();
                const pointsApplicantLevel = String(payload?.applicantLevel || pointsApplicantRec?.level || '').trim();
                const pointsApplicantStore = String(payload?.store || pointsApplicantRec?.store || '').trim();
                const batchItems = Array.isArray(payload?.items) ? payload.items : [];
                let itemsDetailHtml = '';
                if (batchItems.length > 1) {
                    itemsDetailHtml = batchItems.map((it, idx) => `
                        <div style="margin-top:${idx === 0 ? '10' : '8'}px; padding:10px 12px; border-radius:10px; background:rgba(201,169,106,0.04); border:1px solid rgba(201,169,106,0.12);">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:12px; font-weight:700; color:rgba(201,169,106,0.85);">第${idx + 1}条</span>
                                <span style="color:#c9a96a; font-weight:900; font-size:13px;">${Number(it?.points || 0)}分</span>
                            </div>
                            <div style="margin-top:6px; color:rgba(200,215,230,0.85); font-size:13px;">事项：<span style="color:rgba(226,232,240,0.95); font-weight:700;">${escapeHtml(it?.itemName || '-')}</span></div>
                            <div style="margin-top:4px; color:rgba(200,215,230,0.85); font-size:13px;">理由：<span style="color:rgba(226,232,240,0.95);">${escapeHtml(it?.reason || '-')}</span></div>
                        </div>
                    `).join('');
                } else if (batchItems.length === 1) {
                    itemsDetailHtml = `
                        <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; color: rgba(200,215,230,0.85);">事项：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(batchItems[0]?.itemName || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">理由：<div style="margin-top: 6px; color: rgba(226,232,240,0.95);">${escapeHtml(batchItems[0]?.reason || '-')}</div></div>
                    `;
                } else {
                    itemsDetailHtml = `
                        <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; color: rgba(200,215,230,0.85);">事项：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.itemName || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">理由：<div style="margin-top: 6px; color: rgba(226,232,240,0.95);">${escapeHtml(payload?.reason || '-')}</div></div>
                    `;
                }
                payloadHtml = `
                    <div style="margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);">
                        <div style="font-weight: 900;">积分申请信息${batchItems.length > 1 ? `<span style="font-size:12px; font-weight:600; color:rgba(201,169,106,0.85); margin-left:8px;">（共${batchItems.length}条）</span>` : ''}</div>
                        <div style="margin-top: 10px; color: rgba(200,215,230,0.85);">申请人：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(pointsApplicantName || '-')}</span></div>
                        ${pointsApplicantPosition ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">岗位：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(pointsApplicantPosition)}</span></div>` : ''}
                        ${pointsApplicantLevel ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">级别：<span style="color: rgba(139,92,246,0.95); font-weight: 800;">${escapeHtml(pointsApplicantLevel)}</span></div>` : ''}
                        ${pointsApplicantDept ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">部门：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(pointsApplicantDept)}</span></div>` : ''}
                        ${pointsApplicantStore ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">门店：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(pointsApplicantStore)}</span></div>` : ''}
                        <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="color: rgba(200,215,230,0.85);">总积分：<span style="color: #c9a96a; font-weight: 900;">${pts}分</span></span>
                                <span style="color: rgba(200,215,230,0.85);">折算金额：<span style="color: #f59e0b; font-weight: 900;">¥${amount.toFixed(2)}</span></span>
                            </div>
                        </div>
                        ${itemsDetailHtml}
                        ${evidences.length ? `<div style="margin-top: 10px; color: rgba(200,215,230,0.85);">证明图片（点击查看）
                            <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">${evidences.map((u, i) => {
                                const abs = toAbs(u);
                                return `<a href="${escapeHtml(abs)}" target="_blank" rel="noopener" title="查看证据${i + 1}" style="display:block; width:88px; height:88px; border-radius:10px; overflow:hidden; border:1px solid rgba(201,169,106,0.35); background:rgba(255,255,255,0.04);"><img src="${escapeHtml(abs)}" alt="证据${i + 1}" style="width:100%; height:100%; object-fit:cover;"></a>`;
                            }).join('')}</div>
                        </div>` : ''}
                    </div>
                `;
                const mePtsReturned = String(currentUser?.username || '').toLowerCase();
                const appPtsReturned = String(item?.applicant_username || '').toLowerCase();
                if (String(item?.status || '') === 'returned' && mePtsReturned && appPtsReturned === mePtsReturned) {
                    payloadHtml += `<div id="points-returned-edit-wrap" style="margin-top:14px;padding:12px;border-radius:12px;border:1px solid rgba(99,102,241,0.35);background:rgba(99,102,241,0.08);">
                        <div style="font-weight:800;color:#a5b4fc;margin-bottom:8px;">退回修改</div>
                        <div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:10px;">可删除填错的条目、点击「添加积分项」补充新事项；每条需选择事项并填写理由。重新提交不占用当天新建申报次数。</div>
                        <div id="points-returned-rows" style="display:flex;flex-direction:column;gap:12px;"></div>
                        <button type="button" class="btn btn-secondary" onclick="addPointsReturnedResubmitRow()" style="width:100%;margin-top:10px;padding:10px;border-radius:12px;border:1px dashed rgba(148,163,184,0.35);font-size:13px;font-weight:600;">+ 添加积分项</button>
                    </div>`;
                }
            } else if (String(item?.type || '') === 'payment') {
                const amt = Number(payload?.amount || 0);
                const amountText = Number.isFinite(amt) ? ('¥' + amt.toLocaleString('zh-CN', { maximumFractionDigits: 2 })) : '¥0.00';
                payloadHtml = `
                    <div style="margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);">
                        <div style="font-weight: 900;">请款单信息</div>
                        <div style="margin-top: 10px; color: rgba(200,215,230,0.85);">请款日期：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.date || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">请款金额：<span style="color: rgba(59,130,246,0.95); font-weight: 900;">${escapeHtml(amountText)}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">门店：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.store || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">项目：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.category || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">付款对象：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.payee || payload?.payeeName || '无')}</span></div>
                        ${(payload?.payeeAccount) ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">收款账号：<span style="color: #f59e0b; font-weight: 900;">${escapeHtml(payload?.payeeAccount || '-')}</span></div>` : ''}
                        ${(payload?.payeeBank) ? `<div style="margin-top: 8px; color: rgba(200,215,230,0.85);">开户行：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.payeeBank || '-')}</span></div>` : ''}
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">紧急程度：<span style="color: rgba(226,232,240,0.95); font-weight: 800;">${escapeHtml(payload?.urgency || '-')}</span></div>
                        <div style="margin-top: 8px; color: rgba(200,215,230,0.85);">说明：<div style="margin-top: 6px; color: rgba(226,232,240,0.95);">${escapeHtml(payload?.note || '')}</div></div>
                    </div>
                `;
                if (String(item?.status || '') === 'returned' && String(currentUser?.username || '').toLowerCase() === String(item?.applicant_username || '').toLowerCase()) {
                    const _payRnHtml = String(payload?.returnNote||'').trim() ? '<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;font-size:12px;color:rgba(253,186,116,0.9);">退回原因：' + escapeHtml(String(payload.returnNote).trim()) + '</div>' : '';
                    payloadHtml += `<div id="payment-ret-edit" style="margin-top:14px;padding:12px;border-radius:12px;border:1px solid rgba(59,130,246,0.35);background:rgba(59,130,246,0.06);">
                        <div style="font-weight:800;color:#93c5fd;margin-bottom:6px;">修改请款单</div>
                        ${_payRnHtml}
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;">
                            <div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">金额</div><input data-field="amount" type="number" step="0.01" class="form-input payment-ret-field" value="${escapeHtml(payload?.amount!=null?String(payload.amount):'')}"></div>
                            <div><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">日期</div><input data-field="date" type="date" class="form-input payment-ret-field" value="${escapeHtml(payload?.date||'')}"></div>
                        </div>
                        <div style="margin-top:10px;"><div style="font-size:12px;color:rgba(200,215,230,0.72);margin-bottom:4px;">说明</div><textarea data-field="note" class="form-input payment-ret-field" rows="2" style="resize:vertical;">${escapeHtml(payload?.note||'')}</textarea></div>
                    </div>`;
                }
            }

            body.innerHTML = `
                <div style="font-weight: 900;">审批流转</div>
                <div style="margin-top: 8px;">${chainHtml || '<div style="color:#777; font-size: 12px;">暂无流转记录</div>'}</div>
                ${payloadHtml}
            `;

            try {
                if (String(item?.type || '') === 'payment') {
                    const p = payload && typeof payload === 'object' ? payload : {};
                    const store = String(p?.store || '').trim();
                    const secondaryCategory = String(p?.category || '').trim();
                    const primaryCategory = hrmsGetPrimaryCategoryForSecondary(secondaryCategory) || secondaryCategory;
                    const month = hrmsMonthFromDate(String(p?.date || '').trim());
                    if (store && primaryCategory && month) {
                        const extra = `${store} / ${month} / ${primaryCategory}`;
                        const holderId = 'approval-detail-budget-hint';
                        const exist = document.getElementById(holderId);
                        if (!exist) {
                            const div = document.createElement('div');
                            div.id = holderId;
                            div.className = 'settings-hint';
                            div.style.marginTop = '12px';
                            div.textContent = '预算计算中...';
                            body.appendChild(div);
                        }
                        const el = document.getElementById(holderId);
                        if (el) el.textContent = '预算计算中...';
                        HRMS_API.getPaymentBudgetSummary({ store, month, category: primaryCategory, excludeId: String(item?.id || '') })
                            .then(summary => {
                                const box2 = document.getElementById(holderId);
                                if (!box2) return;
                                box2.innerHTML = renderBudgetHintHtml(summary, extra);
                            })
                            .catch(e => {
                                const box2 = document.getElementById(holderId);
                                if (!box2) return;
                                box2.innerHTML = `<span style="color: rgba(239,68,68,0.85);">预算计算失败：${escapeHtml(String(e?.message || e))}</span>`;
                            });
                    }
                }
            } catch (e) {}

            const approveBtn = document.getElementById('approval-detail-approve');
            const rejectBtn = document.getElementById('approval-detail-reject');
            const returnBtn = document.getElementById('approval-detail-return');
            const payBtn = document.getElementById('approval-detail-pay');
            const adminDelBtn = document.getElementById('approval-detail-admin-delete');
            const myUsername = String(currentUser?.username || '').toLowerCase();
            const assigneeMatch = String(item?.current_assignee_username || '').toLowerCase() === myUsername;
            const chainMatch = Array.isArray(item?.chain) && item.chain.some(s => String(s?.assignee || '').toLowerCase() === myUsername && String(s?.status || '') === 'pending');
            const canAct = String(item?.status || '') === 'pending' && myUsername && (assigneeMatch || chainMatch);
            if (approveBtn) approveBtn.style.display = canAct ? '' : 'none';
            if (rejectBtn) rejectBtn.style.display = canAct ? '' : 'none';
            if (returnBtn) returnBtn.style.display = canAct ? '' : 'none';
            if (adminDelBtn) adminDelBtn.style.display = isAdminUser() ? '' : 'none';

            // Show resubmit button for returned approvals where current user is the applicant
            const resubmitBtn = document.getElementById('approval-detail-resubmit');
            if (resubmitBtn) {
                const isReturned = String(item?.status || '') === 'returned';
                const isApplicant = myUsername && String(item?.applicant_username || '').toLowerCase() === myUsername;
                resubmitBtn.style.display = (isReturned && isApplicant) ? '' : 'none';
            }

            // Show departure type selector only for pending offboarding approvals where user can act
            const depTypeBox = document.getElementById('offboarding-departure-type-box');
            if (depTypeBox) {
                const isOffboarding = String(item?.type || '') === 'offboarding';
                depTypeBox.style.display = (isOffboarding && canAct) ? '' : 'none';
                if (isOffboarding && canAct) {
                    const existing = String(payload?.departureType || '').trim();
                    if (existing) selectOffbDepType(existing);
                }
            }

            const promoMentorBox = document.getElementById('promotion-mentor-box');
            if (promoMentorBox) {
                const isPromotion = String(item?.type || '') === 'promotion';
                const stage = String(payload?.promotionStage || 'qualification').trim().toLowerCase();
                const needMentorByStoreMgr = isPromotion && stage === 'qualification' && canAct && String(currentUser?.role || '') === ROLES.STORE_MANAGER;
                promoMentorBox.style.display = needMentorByStoreMgr ? '' : 'none';
                if (needMentorByStoreMgr) {
                    promoRenderTrainingPeriodsEditor(Array.isArray(payload?.trainingPeriods) ? payload.trainingPeriods : []);
                    promoPopulateMentorSelect(item);
                }
            }
            const promoSalaryBox = document.getElementById('promotion-salary-box');
            if (promoSalaryBox) {
                const isPromotion = String(item?.type || '') === 'promotion';
                const stage = String(payload?.promotionStage || 'qualification').trim().toLowerCase();
                const needSalaryByStoreMgr = isPromotion && stage === 'formal' && canAct && String(currentUser?.role || '') === ROLES.STORE_MANAGER;
                promoSalaryBox.style.display = needSalaryByStoreMgr ? '' : 'none';
            }

            // Show remaining leave days input for leave approvals
            const leaveRemBox = document.getElementById('leave-remaining-days-box');
            if (leaveRemBox) {
                const isLeave = String(item?.type || '') === 'leave';
                if (isLeave && canAct) {
                    // Find current user's step index in the chain
                    const myStep = chain.findIndex(s => String(s?.assignee || '').toLowerCase() === myUsername && String(s?.status || '') === 'pending');
                    const isLastStep = myStep === chain.length - 1; // hr_manager (总部人事)
                    const titleEl = document.getElementById('leave-remaining-days-title');
                    const hintEl = document.getElementById('leave-remaining-days-hint');
                    const existingVal = payload?.remainingLeaveDays;
                    const hrInputStep = isLastStep || currentUser?.role === ROLES.HR_MANAGER;
                    if (hrInputStep) {
                        leaveRemBox.style.display = '';
                        if (titleEl) titleEl.innerHTML = '📋 请由总部人事填写（或核实）剩余休假天数' + (existingVal != null && existingVal !== '' ? '<span style="color:rgba(59,130,246,0.95); margin-left:8px; font-size:14px;">(当前：' + escapeHtml(String(existingVal)) + ' 天)</span>' : '');
                        if (hintEl) hintEl.textContent = '通过审批时必须填写，可输入负数（负数表示员工欠假）。';
                    } else {
                        leaveRemBox.style.display = 'none';
                    }
                } else {
                    leaveRemBox.style.display = 'none';
                }
            }

            try {
                const canPay = String(item?.type || '') === 'payment'
                    && String(item?.status || '') === 'approved'
                    && (String(currentUser?.role || '') === ROLES.CASHIER || String(currentUser?.role || '') === ROLES.HQ_MANAGER || String(currentUser?.role || '') === ROLES.HR_MANAGER || isAdminUser());
                if (payBtn) payBtn.style.display = canPay ? '' : 'none';
            } catch (e) {
                if (payBtn) payBtn.style.display = 'none';
            }

            // 离职单显示PDF导出按钮
            const exportPdfBtn = document.getElementById('approval-detail-export-pdf');
            if (exportPdfBtn) {
                exportPdfBtn.style.display = String(item?.type || '') === 'offboarding' ? '' : 'none';
            }

            if (String(item?.type || '') === 'points' && String(item?.status || '') === 'returned' && myUsername && String(item?.applicant_username || '').toLowerCase() === myUsername) {
                try { await initPointsReturnedResubmitEditor(); } catch (e) { console.warn(e); }
            }

            modal.classList.add('show');

            HRMS_API.readApproval(key).then(() => {
                try { refreshUnreadBadges(); } catch (e) {}
            }).catch(() => {});
        }

        function promptReturnApproval() {
            const item = __CURRENT_APPROVAL;
            if (!item) return;
            const id = String(item?.id || '').trim();
            if (!id) return;
            const note = prompt('请输入退回原因（可选）：');
            if (note === null) return;
            HRMS_API.returnApproval(id, String(note || ''))
                .then(() => {
                    showNotification('已退回，申请人可修改后重新提交', 'success');
                    closeApprovalDetailModal();
                    loadApprovalsData();
                })
                .catch((e) => {
                    showNotification('退回失败：' + String(e?.message || e), 'error');
                });
        }

        function resubmitReturnedApproval() {
            const item = __CURRENT_APPROVAL;
            if (!item) return;
            const id = String(item?.id || '').trim();
            if (!id) return;
            if (String(item?.status || '') !== 'returned') {
                showNotification('只有已退回的申请才能重新提交', 'warning');
                return;
            }
            let resubmitBody = {};
            if (String(item?.type || '') === 'points') {
                const rowsEl = document.getElementById('points-returned-rows');
                const rows = rowsEl ? rowsEl.querySelectorAll('.pts-ret-item') : [];
                if (!rows.length) {
                    showNotification('请至少保留一条积分申请', 'warning');
                    return;
                }
                const itemsOut = [];
                for (let i = 0; i < rows.length; i++) {
                    const el = rows[i];
                    const ruleId = String(el.querySelector('.pts-ret-rule')?.value || '').trim();
                    const reason = String(el.querySelector('.pts-ret-reason')?.value || '').trim();
                    if (!ruleId) { showNotification(`第${i + 1}条请选择申请事项`, 'warning'); return; }
                    if (!reason) { showNotification(`第${i + 1}条请填写申请理由`, 'warning'); return; }
                    itemsOut.push({ ruleId, reason });
                }
                resubmitBody.items = itemsOut;
            } else if (String(item?.type || '') === 'onboarding') {
                const _obEmp = {};
                ['name', 'store', 'position', 'department', 'level', 'managerUsername', 'joinDate', 'phone'].forEach(function(f) {
                    const _el = document.getElementById('ob-ret-' + f);
                    if (_el) { const _v = String(_el.value || '').trim(); if (_v) _obEmp[f] = _v; }
                });
                const _roleEl = document.getElementById('ob-ret-role');
                if (_roleEl && _roleEl.value) _obEmp.role = _roleEl.value;
                const _salEl = document.getElementById('ob-ret-salary');
                if (_salEl && _salEl.value !== '') { const _n = Number(_salEl.value); if (Number.isFinite(_n)) _obEmp.salary = _n; }
                if (Object.keys(_obEmp).length) resubmitBody.employee = _obEmp;
            } else {
                const _clsMap = { promotion: '.promo-ret-field', offboarding: '.offb-ret-field', leave: '.leave-ret-field', reward_punishment: '.rp-ret-field', payment: '.payment-ret-field' };
                const _cls = _clsMap[String(item?.type || '')];
                if (_cls) {
                    const _patch = {};
                    document.querySelectorAll(_cls + '[data-field]').forEach(function(_el) {
                        const _f = _el.getAttribute('data-field');
                        if (!_f) return;
                        const _v = _el.type === 'number' ? (_el.value !== '' ? Number(_el.value) : null) : String(_el.value || '').trim();
                        if (_v !== null && _v !== '') _patch[_f] = _v;
                    });
                    if (Object.keys(_patch).length) resubmitBody.patch = _patch;
                }
            }
            if (!confirm('确认重新提交此申请？')) return;
            HRMS_API.resubmitApproval(id, resubmitBody)
                .then(() => {
                    showNotification('已重新提交，等待审批', 'success');
                    closeApprovalDetailModal();
                    loadApprovalsData();
                })
                .catch((e) => {
                    showNotification('重新提交失败：' + String(e?.message || e), 'error');
                });
        }

        function promptRejectApproval() {
            const note = prompt('请输入拒绝原因（可选）：');
            if (note === null) return;
            decideApproval(false, String(note || ''));
        }

        var __OFFB_DEPARTURE_TYPE = '';
        function selectOffbDepType(val) {
            __OFFB_DEPARTURE_TYPE = String(val || '').trim();
            const btns = document.querySelectorAll('.offb-dep-type-btn');
            btns.forEach(b => {
                const v = String(b.getAttribute('data-dep-type') || '');
                const sel = v === __OFFB_DEPARTURE_TYPE;
                b.style.border = sel ? '2px solid ' + (v === 'voluntary' ? '#ea580c' : '#7c3aed') : '2px solid transparent';
                b.style.background = sel ? (v === 'voluntary' ? 'rgba(234,88,12,0.15)' : 'rgba(124,58,237,0.15)') : 'rgba(255,255,255,0.06)';
            });
        }

        function exportApprovalPdf() {
            const item = __CURRENT_APPROVAL;
            if (!item || String(item?.type || '') !== 'offboarding') { showNotification('仅离职单支持导出PDF', 'warning'); return; }
            const payload = typeof item.payload === 'object' ? item.payload : {};
            const chain = Array.isArray(item.chain) ? item.chain : [];
            const statusMap = { pending: '审批中', approved: '已通过', rejected: '已拒绝' };
            const statusLabel = statusMap[item.status] || item.status || '-';
            const depTypeMap = { voluntary: '主动离职（辞职）', involuntary: '被动离职（劝退/裁员）' };
            const depTypeLabel = depTypeMap[payload.departureType] || '-';
            const createdAt = String(item.created_at || item.createdAt || '').slice(0, 19).replace('T', ' ') || '-';
            const applicantName = String(item.applicant_name || '').trim()
                || String(payload.applicantName || '').trim()
                || String(payload.name || '').trim()
                || hrmsDisplayName(item.applicant_username);
            const applicantAccount = String(item.applicant_username || '').trim() || '-';
            const storeDisp = String(payload.store || '').trim() || '-';
            const positionDisp = String(payload.applicantPosition || payload.position || '').trim() || '-';
            const levelDisp = String(payload.applicantLevel || payload.level || '').trim() || '-';
            const joinDisp = String(payload.applicantJoinDate || payload.joinDate || payload.hireDate || '').trim() || '-';
            const chainRows = chain.map((s, i) => {
                const st = s.status === 'approved' ? '✅ 已通过' : s.status === 'rejected' ? '❌ 已拒绝' : s.status === 'pending' ? '⏳ 待审批' : '排队中';
                const decided = s.decidedAt || s.decided_at;
                const at = decided ? String(decided).slice(0, 16).replace('T', ' ') : '-';
                const who = String(s.assignee_name || '').trim() || hrmsDisplayName(s.assignee);
                return `<tr><td>${i + 1}</td><td>${escapeHtml(who)}</td><td>${st}</td><td>${at}</td><td>${escapeHtml(s.note || '')}</td></tr>`;
            }).join('');

            const printHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>离职申请单</title>
<style>
body { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif; font-size: 13px; color: #1a1a1a; margin: 0; padding: 20px; }
.pdf-title { text-align: center; font-size: 22px; font-weight: 900; letter-spacing: 4px; margin-bottom: 6px; }
.pdf-sub { text-align: center; font-size: 12px; color: #666; margin-bottom: 24px; }
.pdf-section { border: 1px solid #ccc; border-radius: 6px; margin-bottom: 18px; overflow: hidden; }
.pdf-section-title { background: #f0f0f0; padding: 8px 14px; font-weight: 900; font-size: 13px; border-bottom: 1px solid #ccc; }
.pdf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.pdf-field { padding: 9px 14px; border-bottom: 1px solid #eee; }
.pdf-field:nth-child(odd) { border-right: 1px solid #eee; }
.pdf-label { font-size: 11px; color: #666; margin-bottom: 3px; }
.pdf-value { font-weight: 700; }
.pdf-full { grid-column: 1 / -1; padding: 9px 14px; border-bottom: 1px solid #eee; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { border: 1px solid #ddd; padding: 7px 10px; text-align: left; }
th { background: #f5f5f5; font-weight: 700; }
.status-badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-weight: 700; font-size: 12px; }
.status-pending { background: #fef3c7; color: #d97706; }
.status-approved { background: #dcfce7; color: #16a34a; }
.status-rejected { background: #fee2e2; color: #dc2626; }
.sig-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; padding: 16px 14px 30px; }
.sig-box { border-bottom: 1px solid #333; padding-bottom: 4px; min-height: 40px; }
.sig-label { font-size: 11px; color: #666; margin-top: 6px; }
@media print { body { padding: 10px; } }
</style></head><body>
<div class="pdf-title">离 职 申 请 单</div>
<div class="pdf-sub">EMPLOYEE RESIGNATION APPLICATION · 编号：${escapeHtml(String(item.id || '-'))}</div>
<div class="pdf-section">
  <div class="pdf-section-title">基本信息</div>
  <div class="pdf-grid">
    <div class="pdf-field"><div class="pdf-label">申请人（姓名）</div><div class="pdf-value">${escapeHtml(applicantName)}</div></div>
    <div class="pdf-field"><div class="pdf-label">登录账号</div><div class="pdf-value">${escapeHtml(applicantAccount)}</div></div>
    <div class="pdf-field"><div class="pdf-label">所属门店</div><div class="pdf-value">${escapeHtml(storeDisp)}</div></div>
    <div class="pdf-field"><div class="pdf-label">岗位</div><div class="pdf-value">${escapeHtml(positionDisp)}</div></div>
    <div class="pdf-field"><div class="pdf-label">入职时间</div><div class="pdf-value">${escapeHtml(joinDisp)}</div></div>
    <div class="pdf-field"><div class="pdf-label">员工级别</div><div class="pdf-value">${escapeHtml(levelDisp)}</div></div>
    <div class="pdf-field"><div class="pdf-label">提交日期</div><div class="pdf-value">${escapeHtml(createdAt)}</div></div>
    <div class="pdf-field"><div class="pdf-label">期望离职日期</div><div class="pdf-value">${escapeHtml(payload.resignDate || '-')}</div></div>
    <div class="pdf-full"><div class="pdf-label">审批状态</div><div class="pdf-value"><span class="status-badge status-${item.status || 'pending'}">${escapeHtml(statusLabel)}</span></div></div>
  </div>
</div>
<div class="pdf-section">
  <div class="pdf-section-title">离职详情</div>
  <div class="pdf-grid">
    <div class="pdf-field"><div class="pdf-label">离职原因（分类）</div><div class="pdf-value">${escapeHtml(payload.reason || '-')}</div></div>
    <div class="pdf-field"><div class="pdf-label">离职类型</div><div class="pdf-value">${escapeHtml(depTypeLabel)}</div></div>
    <div class="pdf-field"><div class="pdf-label">是否与上级沟通</div><div class="pdf-value">${escapeHtml(payload.communicated || '-')}</div></div>
    <div class="pdf-field"><div class="pdf-label">上级是否面谈</div><div class="pdf-value">${escapeHtml(payload.interviewed || '-')}</div></div>
    <div class="pdf-field"><div class="pdf-label">直属上级是否同意</div><div class="pdf-value">${escapeHtml(payload.managerAgreed || '-')}</div></div>
    <div class="pdf-full"><div class="pdf-label">具体说明</div><div style="margin-top:4px; white-space: pre-wrap; line-height:1.6;">${escapeHtml(payload.detail || '-')}</div></div>
  </div>
</div>
<div class="pdf-section">
  <div class="pdf-section-title">审批流程</div>
  <table><thead><tr><th>步骤</th><th>审批人</th><th>状态</th><th>审批时间</th><th>备注</th></tr></thead>
  <tbody>${chainRows}</tbody></table>
</div>
<div class="pdf-section">
  <div class="pdf-section-title">签字确认</div>
  <div class="sig-row">
    <div><div class="sig-box"></div><div class="sig-label">申请人签字</div></div>
    <div><div class="sig-box"></div><div class="sig-label">直属上级签字</div></div>
    <div><div class="sig-box"></div><div class="sig-label">人事负责人签字</div></div>
  </div>
</div>
<div style="text-align:right; font-size:11px; color:#999; margin-top:8px;">打印时间：${new Date().toLocaleString('zh-CN')} · HRMS 人力资源管理系统</div>
</body></html>`;

            const w = window.open('', '_blank', 'width=860,height=1100');
            if (!w) { showNotification('弹窗被拦截，请允许本站弹窗后重试', 'warning'); return; }
            w.document.write(printHtml);
            w.document.close();
            w.focus();
            setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
        }

        function promoAddTrainingPeriodRow(seed) {
            const box = document.getElementById('promotion-training-periods-editor');
            if (!box) return;
            const idx = box.querySelectorAll('.promo-period-row').length + 1;
            const row = document.createElement('div');
            row.className = 'promo-period-row';
            row.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;align-items:end;background:rgba(15,23,42,0.35);border:1px solid rgba(255,255,255,0.08);padding:8px;border-radius:10px;';
            row.innerHTML = `
                <div>
                    <div style="font-size:11px; color:rgba(200,215,230,0.72); margin-bottom:4px;">开始日期</div>
                    <input type="date" class="form-input promo-period-start" value="${escapeHtml(String(seed?.startDate || ''))}">
                </div>
                <div>
                    <div style="font-size:11px; color:rgba(200,215,230,0.72); margin-bottom:4px;">结束日期</div>
                    <input type="date" class="form-input promo-period-end" value="${escapeHtml(String(seed?.endDate || seed?.startDate || ''))}">
                </div>
                <div>
                    <div style="font-size:11px; color:rgba(200,215,230,0.72); margin-bottom:4px;">培训内容</div>
                    <input type="text" class="form-input promo-period-title" placeholder="如：岗位基础/高峰实战" value="${escapeHtml(String(seed?.title || `培训周期${idx}`))}">
                </div>
                <div>
                    <button type="button" class="btn btn-secondary" style="width:100%; padding:8px 10px; font-size:12px;" onclick="this.closest('.promo-period-row').remove();">删除</button>
                </div>
            `;
            box.appendChild(row);
        }

        function promoRenderTrainingPeriodsEditor(periods) {
            const box = document.getElementById('promotion-training-periods-editor');
            if (!box) return;
            box.innerHTML = '';
            const list = Array.isArray(periods) ? periods : [];
            if (!list.length) {
                promoAddTrainingPeriodRow();
                return;
            }
            list.forEach((p) => promoAddTrainingPeriodRow(p));
        }

        function promoCollectTrainingPeriodsFromEditor() {
            const rows = Array.from(document.querySelectorAll('#promotion-training-periods-editor .promo-period-row'));
            const out = [];
            rows.forEach((r, idx) => {
                const startDate = String(r.querySelector('.promo-period-start')?.value || '').trim();
                const endDate = String(r.querySelector('.promo-period-end')?.value || '').trim();
                const title = String(r.querySelector('.promo-period-title')?.value || '').trim() || `培训周期${idx + 1}`;
                if (!startDate || !endDate) return;
                out.push({ startDate, endDate, title });
            });
            return out;
        }

        function decideApproval(approved, note) {
            const item = __CURRENT_APPROVAL;
            if (!item) return;
            const id = String(item?.id || '').trim();
            if (!id) return;

            // For offboarding approvals, include departure type
            const extra = {};
            if (String(item?.type || '') === 'offboarding' && approved) {
                const dt = __OFFB_DEPARTURE_TYPE;
                if (!dt) {
                    showNotification('请先选择离职类型（主动/被动）', 'warning');
                    return;
                }
                extra.departureType = dt;
            }

            // For leave approvals, include remaining leave days
            if (String(item?.type || '') === 'leave') {
                const remBox = document.getElementById('leave-remaining-days-box');
                if (remBox && remBox.style.display !== 'none') {
                    const remInput = document.getElementById('leave-remaining-days-input');
                    const remVal = String(remInput?.value || '').trim();
                    if (approved && !remVal) {
                        showNotification('请填写该员工剩余休假天数', 'warning');
                        return;
                    }
                    if (remVal) {
                        const num = Number(remVal);
                        if (!Number.isFinite(num)) {
                            showNotification('请填写有效的剩余休假天数', 'warning');
                            return;
                        }
                        extra.remainingLeaveDays = num;
                    }
                }
            }

            // For promotion qualification approval (store manager step), include mentor + training plan fields
            if (String(item?.type || '') === 'promotion' && approved) {
                const stage = String(item?.payload?.promotionStage || 'qualification').trim().toLowerCase();
                if (stage === 'qualification' && String(currentUser?.role || '') === ROLES.STORE_MANAGER) {
                    const mentorUsername = String(document.getElementById('promotion-mentor-username-input')?.value || '').trim();
                    const mentorName = String(document.getElementById('promotion-mentor-name-input')?.value || '').trim();
                    const trainingStartDate = String(document.getElementById('promotion-training-start-input')?.value || '').trim();
                    const trainingDaysRaw = String(document.getElementById('promotion-training-days-input')?.value || '').trim();
                    const trainingDays = Number(trainingDaysRaw || 3);
                    const trainingPeriods = promoCollectTrainingPeriodsFromEditor();
                    if (!mentorUsername) {
                        showNotification('请填写带教人账号', 'warning');
                        return;
                    }
                    if (!trainingStartDate && !trainingPeriods.length) {
                        showNotification('请填写培训开始日期或培训周期', 'warning');
                        return;
                    }
                    if (!Number.isFinite(trainingDays) || trainingDays < 1 || trainingDays > 30) {
                        showNotification('培训周期请填写 1-30 天', 'warning');
                        return;
                    }
                    extra.mentorUsername = mentorUsername;
                    if (mentorName) extra.mentorName = mentorName;
                    if (trainingStartDate) extra.trainingStartDate = trainingStartDate;
                    extra.trainingDays = Math.floor(trainingDays);
                    if (trainingPeriods.length) extra.trainingPeriods = trainingPeriods;
                }
                if (stage === 'formal' && String(currentUser?.role || '') === ROLES.STORE_MANAGER) {
                    const salaryRaw = String(document.getElementById('promotion-promoted-salary-input')?.value || '').trim();
                    const promotedSalary = Number(salaryRaw);
                    if (!Number.isFinite(promotedSalary) || promotedSalary <= 0) {
                        showNotification('请填写有效的晋升后薪资', 'warning');
                        return;
                    }
                    extra.promotedSalary = Number(promotedSalary.toFixed(2));
                }
            }

            HRMS_API.decideApproval(id, !!approved, String(note || ''), extra)
                .then(() => {
                    __OFFB_DEPARTURE_TYPE = '';
                    showNotification(approved ? '已通过' : '已拒绝', 'success');
                    closeApprovalDetailModal();
                    loadApprovalsData();
                    try { loadPaymentData(); } catch (e) {}
                })
                .catch((e) => {
                    showNotification('操作失败：' + String(e?.message || e), 'error');
                });
        }

        function payCurrentApproval() {
            const item = __CURRENT_APPROVAL;
            if (!item) return;
            if (String(item?.type || '') !== 'payment') return;
            if (String(item?.status || '') !== 'approved') {
                showNotification('该请款单尚未完成审核', 'warning');
                return;
            }
            if (!(String(currentUser?.role || '') === ROLES.CASHIER || isAdminUser())) {
                showNotification('仅出纳/管理员可标记付款', 'warning');
                return;
            }
            const note = prompt('付款备注（可选）：') ?? '';
            if (note === null) return;
            const id = String(item?.id || '').trim();
            if (!id) return;
            HRMS_API.payPayment(id, String(note || ''))
                .then(() => {
                    showNotification('已标记为已付款', 'success');
                    closeApprovalDetailModal();
                    try { loadApprovalsData(); } catch (e) {}
                    try { loadPaymentData(); } catch (e) {}
                })
                .catch(e => {
                    showNotification('付款失败：' + String(e?.message || e), 'error');
                });
        }

        async function adminDeleteCurrentApproval() {
            if (!isAdminUser()) { showNotification('仅管理员可删除', 'warning'); return; }
            const item = __CURRENT_APPROVAL;
            if (!item) return;
            const id = String(item?.id || '').trim();
            if (!id) return;
            const typeLabel = approvalTypeText(item?.type);
            const _okAp = await hrmsConfirm({ title: '删除审批记录', message: `确定删除此${typeLabel}记录？此操作不可恢复。`, okText: '确认删除', icon: '📝' });
            if (!_okAp) return;
            try {
                const resp = await fetch('/api/approvals/' + encodeURIComponent(id), {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('hrms_token') || '') }
                });
                const data = await resp.json();
                if (!resp.ok) { showNotification('删除失败：' + (data.error || '未知错误'), 'error'); return; }
                showNotification(typeLabel + '记录已删除', 'success');
                closeApprovalDetailModal();
                try { loadApprovalsData(); } catch (e) {}
                try { loadPaymentData(); } catch (e) {}
                try { loadRewardsData(); } catch (e) {}
            } catch (e) {
                showNotification('提交失败：' + String(e?.message || e), 'error');
            }
        }

        // ─── Garbled UTF-8 repair (mojibake: UTF-8 bytes mis-decoded as Latin-1) ───
        function hrmsRepairGarbledUtf8(str) {
            if (typeof str !== 'string' || str.length < 2) return str;
            if (!/[\u00c0-\u00ff]/.test(str)) return str;
            try {
                const bytes = new Uint8Array(str.length);
                for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
                const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                if (/[\u4e00-\u9fff]/.test(decoded)) return decoded;
            } catch (e) {}
            return str;
        }
        function hrmsDeepRepairGarbled(obj) {
            if (obj === null || obj === undefined) return obj;
            if (typeof obj === 'string') return hrmsRepairGarbledUtf8(obj);
            if (Array.isArray(obj)) return obj.map(hrmsDeepRepairGarbled);
            if (typeof obj === 'object') {
                const out = {};
                for (const k of Object.keys(obj)) out[hrmsRepairGarbledUtf8(k)] = hrmsDeepRepairGarbled(obj[k]);
                return out;
            }
            return obj;
        }

        HRMS_STORE.ensure();

        // Auto-repair garbled localStorage data on page load
        try {
            const raw = localStorage.getItem(HRMS_STORAGE_KEY);
            if (raw && /[\u00c0-\u00ff]/.test(raw)) {
                const parsed = hrmsSafeParseJson(raw);
                if (parsed) {
                    const repaired = hrmsDeepRepairGarbled(parsed);
                    const repairedJson = JSON.stringify(repaired);
                    if (repairedJson !== raw) {
                        console.log('[HRMS] Auto-repaired garbled UTF-8 in localStorage');
                        localStorage.setItem(HRMS_STORAGE_KEY, repairedJson);
                    }
                }
            }
        } catch (e) { console.warn('[HRMS] localStorage repair failed:', e); }

        try {
            if (__UNREAD_BADGES_TIMER) clearInterval(__UNREAD_BADGES_TIMER);
            __UNREAD_BADGES_TIMER = setInterval(() => {
                try { refreshUnreadBadges(); } catch (e) {}
            }, 25000);
        } catch (e) {}

        let __hrmsStateSyncTimer = null;
        let __hrmsStateSyncInFlight = false;

        function hrmsScheduleStateSave() {
            try {
                if (!isLoggedIn || !currentUser) return;
                if (!HRMS_API.token()) return;
                if (!isAdminUser()) return;
                if (__hrmsStateSyncTimer) clearTimeout(__hrmsStateSyncTimer);
                __hrmsStateSyncTimer = setTimeout(async () => {
                    if (__hrmsStateSyncInFlight) return;
                    try {
                        if (!isLoggedIn || !currentUser) return;
                        if (!HRMS_API.token()) return;
                        if (!isAdminUser()) return;
                    } catch (e) {
                        return;
                    }
                    __hrmsStateSyncInFlight = true;
                    try {
                        const serverResp = await HRMS_API.getState();
                        const serverData = (serverResp && typeof serverResp === 'object' ? (serverResp.data || serverResp) : {}) || {};
                        ['dailyReports', 'inventoryForecastHistory', 'pointRecords'].forEach(k => { if (serverData[k] !== undefined) _hrmsServerPassthrough[k] = serverData[k]; });
                        const localData = HRMS_STORE.ensure();
                        const serverOnlyKeys = ['approvalFlows', 'paymentFlowByStore', 'roleModules'];
                        const merged = { ...localData };
                        serverOnlyKeys.forEach(k => { if (serverData[k] !== undefined && merged[k] === undefined) merged[k] = serverData[k]; });
                        if (Array.isArray(serverData.employees) && serverData.employees.length > 0) {
                            const _lEmps = Array.isArray(merged.employees) ? merged.employees : [];
                            const _lUnames = new Set(_lEmps.map(e => String(e?.username || '').toLowerCase()).filter(Boolean));
                            const _sOnly = serverData.employees.filter(e => { const u = String(e?.username || '').toLowerCase(); return u && !_lUnames.has(u); });
                            if (_sOnly.length > 0) {
                                merged.employees = [..._lEmps, ..._sOnly];
                                try { const _r = localStorage.getItem(HRMS_STORAGE_KEY); if (_r) { const _p = JSON.parse(_r); if (_p) { _p.employees = merged.employees; localStorage.setItem(HRMS_STORAGE_KEY, JSON.stringify(_p)); } } } catch (_e) {}
                            }
                        }
                        await HRMS_API.saveState(merged);
                    } catch (e) {
                        console.error('save state failed:', e);
                    } finally {
                        __hrmsStateSyncInFlight = false;
                    }
                }, 800);
            } catch (e) {
                // ignore
            }
        }

        async function hrmsFlushStateSave() {
            try {
                if (!isLoggedIn || !currentUser) return false;
                if (!HRMS_API.token()) return false;
                if (!isAdminUser()) return false;
                if (__hrmsStateSyncTimer) {
                    try { clearTimeout(__hrmsStateSyncTimer); } catch (e) {}
                    __hrmsStateSyncTimer = null;
                }
                if (__hrmsStateSyncInFlight) return false;
                __hrmsStateSyncInFlight = true;
                const serverResp = await HRMS_API.getState();
                const serverData = (serverResp && typeof serverResp === 'object' ? (serverResp.data || serverResp) : {}) || {};
                ['dailyReports', 'inventoryForecastHistory', 'pointRecords'].forEach(k => { if (serverData[k] !== undefined) _hrmsServerPassthrough[k] = serverData[k]; });
                const localData = HRMS_STORE.ensure();
                const serverOnlyKeys = ['approvalFlows', 'paymentFlowByStore', 'roleModules'];
                const merged = { ...localData };
                serverOnlyKeys.forEach(k => { if (serverData[k] !== undefined && merged[k] === undefined) merged[k] = serverData[k]; });
                if (Array.isArray(serverData.employees) && serverData.employees.length > 0) {
                    const _lEmps = Array.isArray(merged.employees) ? merged.employees : [];
                    const _lUnames = new Set(_lEmps.map(e => String(e?.username || '').toLowerCase()).filter(Boolean));
                    const _sOnly = serverData.employees.filter(e => { const u = String(e?.username || '').toLowerCase(); return u && !_lUnames.has(u); });
                    if (_sOnly.length > 0) {
                        merged.employees = [..._lEmps, ..._sOnly];
                        try { const _r = localStorage.getItem(HRMS_STORAGE_KEY); if (_r) { const _p = JSON.parse(_r); if (_p) { _p.employees = merged.employees; localStorage.setItem(HRMS_STORAGE_KEY, JSON.stringify(_p)); } } } catch (_e) {}
                    }
                }
                await HRMS_API.saveState(merged);
                return true;
            } catch (e) {
                console.error('save state failed:', e);
                return false;
            } finally {
                __hrmsStateSyncInFlight = false;
            }
        }

        window.addEventListener('beforeunload', () => {
            try {
                if (!isLoggedIn || !currentUser) return;
                if (!isAdminUser()) return;
                const token = HRMS_API.token();
                if (!token) return;
                const url = (HRMS_API.baseUrl() || '') + '/api/state';
                const _bfData = Object.assign({}, HRMS_STORE.ensure());
                ['dailyReports', 'inventoryForecastHistory', 'pointRecords'].forEach(function(k) { if (_hrmsServerPassthrough[k] !== undefined) _bfData[k] = _hrmsServerPassthrough[k]; });
                const payload = JSON.stringify({ data: _bfData });
                try {
                    fetch(url, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: payload,
                        keepalive: true
                    });
                } catch (e) {}
            } catch (e) {}
        });

        async function hrmsLoadStateFromServer() {
            try {
                if (!HRMS_API.token()) return false;
                const resp = await HRMS_API.getState();
                const data = resp?.data;
                if (data && typeof data === 'object') {
                    ['dailyReports', 'inventoryForecastHistory', 'pointRecords'].forEach(function(k) { if (data[k] !== undefined) _hrmsServerPassthrough[k] = data[k]; });
                    HRMS_STORE.set(data);
                    refreshBrandsCache(true).then(() => {
                        populateKnowledgeBrandOptions('all');
                        populateKnowledgeFilterBrandOptions(getKnowledgeFilterState()?.brandId || '');
                        populateStoreBrandSelect('');
                        populateReportsBrandSelect(document.getElementById('rep-brand')?.value || '');
                        populateAmBrandFilter(__AM_BRAND_FILTER || 'all');
                    });
                    return true;
                }
                return false;
            } catch (e) {
                const st = Number(e?.status || 0);
                if (st === 404) {
                    if (isAdminUser()) {
                        try {
                            await HRMS_API.saveState(HRMS_STORE.ensure());
                            return true;
                        } catch (e2) {
                            return false;
                        }
                    }
                    return false;
                }
                // For non-admin users, state might not be ready yet or permission differs.
                // Do not hard-fail login bootstrap.
                return false;
            }
        }

        async function hrmsTryRestoreSessionOnLoad() {
            try {
                const token = HRMS_API.token();
                if (!token) return false;

                const resp = await HRMS_API.request('/api/auth/me', { method: 'GET' });
                const u = resp?.user;
                if (!u) return false;

                const employees = HRMS_STORE.getEmployees() || [];
                const empInfo = employees.find(e => String(e?.username || '').toLowerCase() === String(u.username || '').toLowerCase()) || {};
                const users = HRMS_STORE.getUsers() || [];
                const userInfo = users.find(x => x && String(x.username || '').toLowerCase() === String(u.username || '').toLowerCase()) || {};

                currentUser = hydrateCurrentUserFromApiUser(u);
                isLoggedIn = true;

                // 先显示主界面，不阻塞
                document.getElementById('login').classList.add('hidden');
                document.getElementById('main-app').classList.remove('hidden');
                updateUserInfo();
                restoreSidebarState();
                try { updateKitchenNavVisibility(); } catch(e) {}
                try { updateGrowthModuleVisibility(); updateStrategyModuleVisibility(); } catch(e) {}
                showPage(getHomePageName());
                maybeOpenSmartAssistantFromRoute();

                // 后台异步加载state和角色模块
                hrmsLoadStateFromServer().then(() => {
                    try {
                        const employees2 = HRMS_STORE.getEmployees() || [];
                        const empInfo2 = employees2.find(e => String(e?.username || '').toLowerCase() === String(u.username || '').toLowerCase()) || {};
                        if (empInfo2.name) currentUser.name = empInfo2.name;
                        if (empInfo2.store && !currentUser.current_store) currentUser.store = empInfo2.store;
                        if (empInfo2.role) { const r2 = hrmsNormalizeRoleCode(empInfo2.role); if (r2) currentUser.role = r2; }
                        if (empInfo2.position) currentUser.position = empInfo2.position;
                        if (empInfo2.department) currentUser.department = empInfo2.department;
                        updateUserInfo();
                        try { updateKitchenNavVisibility(); } catch(e) {}
                        try { updateGrowthModuleVisibility(); updateStrategyModuleVisibility(); } catch(e) {}
                    } catch (e) {}
                    try { loadProfileData(); } catch (e) {}
                    try { if (!document.getElementById('employees-page')?.classList.contains('hidden')) loadEmployeesData(); } catch (e) {}
                }).catch(() => {});
                loadRoleModulesFromServer().catch(() => {});
                loadPermissionGroupsFromServer().catch(() => {});
                try { refreshUnreadBadges(); } catch (e) {}

                return true;
            } catch (e) {
                try { HRMS_API.clearToken(); } catch (e2) {}
                return false;
            }
        }
        
        // 检查权限
        function hasPermission(permission) {
            if (!currentUser) return false;
            const userPermissions = ROLE_PERMISSIONS[currentUser.role] || [];
            return userPermissions.includes(permission);
        }
        
        // 检查角色
        function hasRole(role) {
            return currentUser && currentUser.role === role;
        }

        function hrmsIsRoleCanSeeDailyReport(role) {
            return canAccessModulePage('daily-report', role);
        }

        function hrmsIsRoleCanWriteDailyReport(role) {
            return role === ROLES.ADMIN || role === ROLES.STORE_MANAGER || role === ROLES.FRONT_MANAGER || role === ROLES.FRONT_SUPERVISOR;
        }

        function hrmsIsRoleAdmin(role) {
            return role === ROLES.ADMIN;
        }
        
        // 获取角色显示名称
        function getRoleDisplayName(role) {
            const roleNames = {
                [ROLES.ADMIN]: '系统管理员',
                [ROLES.HQ_MANAGER]: '总部营运',
                [ROLES.HR_MANAGER]: '总部人事',
                [ROLES.STORE_MANAGER]: '店长',
                [ROLES.CASHIER]: '总部出纳',
                [ROLES.EMPLOYEE]: '门店员工',
                [ROLES.PRODUCTION_MANAGER]: '出品经理',
                [ROLES.FRONT_MANAGER]: '前厅经理',
                [ROLES.FRONT_SUPERVISOR]: '前厅主管'
            };
            const v = String(role || '').trim();
            if (roleNames[v]) return roleNames[v];
            if (v.startsWith('custom_')) return v.slice('custom_'.length);
            return v || '未知角色';
        }

        function hrmsCanAccessPayments(role) {
            return canAccessModulePage('payment', role);
        }

        function hrmsCanCreatePayments(role) {
            const r = String(role || '').trim();
            return r === ROLES.ADMIN || r === ROLES.HQ_MANAGER || r === ROLES.HR_MANAGER || r === ROLES.STORE_MANAGER || r === ROLES.FRONT_MANAGER;
        }

        function hrmsCanAccessSmartAssistant(role) {
            const r = String(role || '').trim();
            return r === ROLES.ADMIN || r === ROLES.STORE_MANAGER || r === ROLES.PRODUCTION_MANAGER || r === ROLES.HQ_MANAGER;
        }

        function hrmsIsAlwaysAllowedPage(pageName) {
            // 考试测评已被培训认证取代，不再单独保留；培训认证改为所有人永远可见
            return ['profile', 'attendance', 'training', 'points'].includes(String(pageName || '').trim());
        }

        // 服务端加载的角色模块配置（登录后从API获取）
        let _serverRoleModules = null;
        // 知识库模块仅 admin 可见（用于上传培训资料），其他角色一律不显示
        const _defaultRoleModules = {
            [ROLES.EMPLOYEE]:           ['profile', 'attendance', 'exam', 'points', 'kitchen', 'training'],
            [ROLES.STORE_MANAGER]:      ['profile', 'attendance', 'exam', 'points', 'employees', 'daily-report', 'approvals', 'payment', 'rewards', 'reports', 'agents', 'kitchen', 'training'],
            [ROLES.PRODUCTION_MANAGER]: ['profile', 'attendance', 'exam', 'points', 'rewards', 'forecast', 'kitchen', 'training'],
            [ROLES.HQ_MANAGER]:         ['profile', 'attendance', 'exam', 'points', 'employees', 'daily-report', 'approvals', 'payment', 'rewards', 'reports', 'kitchen', 'training'],
            [ROLES.HR_MANAGER]:         ['profile', 'attendance', 'exam', 'points', 'employees', 'approvals', 'payment', 'rewards', 'reports', 'training'],
            [ROLES.FRONT_MANAGER]:      ['profile', 'attendance', 'exam', 'points', 'daily-report', 'payment', 'training'],
            [ROLES.FRONT_SUPERVISOR]:   ['profile', 'attendance', 'exam', 'points', 'daily-report', 'training'],
            [ROLES.CASHIER]:            ['profile', 'attendance', 'exam', 'points', 'payment', 'approvals', 'training']
        };
        async function loadRoleModulesFromServer() {
            try {
                const headers = {};
                const tok = (HRMS_API && typeof HRMS_API.token === 'function') ? HRMS_API.token() : (localStorage.getItem('hrms_token') || localStorage.getItem('HRMS_API_TOKEN') || '');
                if (tok) headers['Authorization'] = 'Bearer ' + tok;
                const r = await fetch('/api/role-modules', { credentials: 'include', headers });
                if (r.ok) { const d = await r.json(); if (d?.config) _serverRoleModules = d.config; }
            } catch (e) { console.warn('[role-modules] load failed:', e); }
        }

        // 权限组：同角色/岗位的员工可按租户自定义不同模块权限（与角色默认模块互不影响）
        let _serverPermissionGroups = [];
        const _PAYROLL_PERMISSION_OPTIONS = [
            { id: 'module.reports', label: '分析报表入口' },
            { id: 'reports.payroll.view', label: '查看薪资报表' },
            { id: 'reports.payroll.export', label: '导出薪资报表' },
            { id: 'reports.payroll.adjust', label: '调整补贴/底薪' },
            { id: 'reports.payroll.audit', label: '薪资审核切换' },
            { id: 'reports.payroll.month_run', label: '月结锁定/发放' },
            { id: 'reports.payroll.rules', label: '考勤薪资规则' },
            { id: 'reports.payroll.ledger', label: '薪资账本' },
            { id: 'reports.payroll.abnormal_confirm', label: '确认考勤异常' },
            { id: 'reports.leave_owed.view', label: '欠休报表' },
            { id: 'reports.leave_owed.adjust', label: '调整累计假期' },
            { id: 'employee.salary.view', label: '查看员工薪资字段' },
            { id: 'employee.salary.edit', label: '编辑员工薪资' },
            { id: 'admin.permission_manage', label: '管理权限配置' }
        ];

        async function loadPermissionPolicySettings() {
            const statusEl = document.getElementById('permission-policy-status');
            const modeEl = document.getElementById('permission-policy-mode');
            if (statusEl) statusEl.textContent = '加载中...';
            try {
                const tok = localStorage.getItem('hrms_token') || '';
                const r = await fetch('/api/hrms/permissions/policy', { headers: { Authorization: 'Bearer ' + tok } });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const d = await r.json();
                if (modeEl) modeEl.value = String(d?.enforcement_mode || 'legacy');
                if (statusEl) statusEl.textContent = '当前模式：' + String(d?.enforcement_mode || 'legacy') + ' · 授权条目 ' + (Array.isArray(d?.grants) ? d.grants.length : 0);
            } catch (e) {
                if (statusEl) statusEl.textContent = '加载失败：' + String(e?.message || e);
            }
        }

        async function savePermissionPolicySettings() {
            const mode = String(document.getElementById('permission-policy-mode')?.value || 'legacy').trim();
            const ok = await hrmsConfirm({
                title: '保存权限策略',
                message: '切换为 ' + mode + ' 将影响全租户 API 鉴权。strict 模式下未显式授权的操作将被拒绝。确认保存？',
                okText: '确认保存',
                icon: '🔐'
            });
            if (!ok) return;
            try {
                const tok = localStorage.getItem('hrms_token') || '';
                const r = await fetch('/api/hrms/permissions/policy', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
                    body: JSON.stringify({ enforcement_mode: mode })
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d?.error || ('HTTP ' + r.status));
                showNotification('权限策略已更新：' + mode, 'success');
                await loadPermissionPolicySettings();
                try {
                    const me = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + tok } }).then((x) => x.json());
                    if (me?.user && currentUser) {
                        currentUser.enforcement_mode = me.user.enforcement_mode;
                        currentUser.permissions = me.user.permissions || [];
                    }
                } catch (_) {}
            } catch (e) {
                showNotification('保存失败：' + String(e?.message || e), 'error');
            }
        }
        async function loadPermissionGroupsFromServer() {
            try {
                const headers = {};
                const tok = (HRMS_API && typeof HRMS_API.token === 'function') ? HRMS_API.token() : (localStorage.getItem('hrms_token') || localStorage.getItem('HRMS_API_TOKEN') || '');
                if (tok) headers['Authorization'] = 'Bearer ' + tok;
                const r = await fetch('/api/permission-groups', { credentials: 'include', headers });
                if (r.ok) { const d = await r.json(); _serverPermissionGroups = Array.isArray(d?.groups) ? d.groups : []; }
            } catch (e) { console.warn('[permission-groups] load failed:', e); }
        }

        // 系统设置改成"9个卡片"形式：点卡片只显示对应一个分区，其余收起；返回按钮回总览。
        // 几个分区本来就有"仅admin可见"的二次门槛(在系统设置页init时设置display:none)，
        // 这里维护同一份名单，点卡片时复查一次，避免直接把display强制设成''盖过权限隐藏。
        const SETTINGS_ADMIN_ONLY_CARDS = [
            'org-dict-settings-card', 'monthly-target-settings-card', 'approval-flow-settings-card',
            'points-rule-settings-card', 'attendance-payroll-rules-card', 'brands-settings-card', 'store-duty-settings-card',
            'permission-groups-settings-card'
        ];
        function showSettingsCard(cardId) {
            if (SETTINGS_ADMIN_ONLY_CARDS.includes(cardId) && !isAdminUser()) {
                showNotification('您没有该分区的查看权限', 'warning');
                return;
            }
            const overview = document.getElementById('settings-overview');
            if (overview) overview.style.display = 'none';
            document.querySelectorAll('#settings-page .settings-rep-sec').forEach((el) => { el.style.display = 'none'; });
            const target = document.getElementById(cardId);
            if (target) target.style.display = '';
            const backBtn = document.getElementById('settings-back-btn');
            if (backBtn) backBtn.style.display = '';
            window.scrollTo(0, 0);
            if (cardId === 'attendance-payroll-rules-card') {
                try { loadAttendancePayrollRulesSettings(); } catch (_) {}
            }
        }

        async function loadAttendancePayrollRulesSettings() {
            const listEl = document.getElementById('apr-rules-list');
            if (listEl) listEl.textContent = '加载中...';
            try {
                const resp = await fetch('/api/hrms/attendance-payroll-rules', {
                    headers: { Authorization: 'Bearer ' + (localStorage.getItem('hrms_token') || '') }
                }).then((r) => r.json());
                const rows = Array.isArray(resp?.rows) ? resp.rows : [];
                if (listEl) {
                    if (!rows.length) {
                        listEl.innerHTML = '<div style="opacity:0.7;">暂无规则行（启动后会自动种子洪潮/马己仙）</div>';
                    } else {
                        listEl.innerHTML = rows.map((row) => {
                            const rj = row.rules_json || {};
                            return `<div style="padding:8px 0;border-bottom:1px solid rgba(148,163,184,0.15);">
                              <strong>${escapeHtml(String(row.scope_type || ''))}</strong> /
                              <code>${escapeHtml(String(row.scope_key || '(tenant)'))}</code>
                              · 月应休 ${escapeHtml(String(rj.monthlyRestDays ?? '-'))}
                              · 积分 ${escapeHtml(String(rj.pointsYuanPerPoint ?? '-'))}元/分
                              · 晋升 ${escapeHtml(String(rj.promotionEffective || '-'))}
                              · 更新 ${escapeHtml(String(row.updated_at || '').slice(0, 19))}
                            </div>`;
                        }).join('');
                    }
                }
                const wantKey = String(document.getElementById('apr-scope-key')?.value || 'hongchao').trim();
                const brandRow = rows.find((r) => String(r.scope_type) === 'brand' && String(r.scope_key) === wantKey)
                  || rows.find((r) => String(r.scope_type) === 'brand')
                  || rows.find((r) => String(r.scope_type) === 'tenant');
                if (brandRow?.rules_json) {
                    const rj = brandRow.rules_json;
                    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
                    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
                    setVal('apr-monthly-rest', rj.monthlyRestDays);
                    setVal('apr-points-rate', rj.pointsYuanPerPoint);
                    setVal('apr-pay-day', rj.payDayOfMonth);
                    setChk('apr-leave-auth', rj.approvedLeaveAuthoritative !== false);
                    setChk('apr-owe-full', rj.oweLeaveStillFullAttendance !== false);
                    setChk('apr-offset-leave', rj.offsetMissingWithRemainingLeave !== false);
                    setChk('apr-subsidy-add', rj.manualSubsidyAddsWithPoints !== false);
                }
            } catch (e) {
                if (listEl) listEl.textContent = '加载失败：' + String(e?.message || e);
            }
        }

        async function saveAttendancePayrollRulesSettings() {
            const scopeType = String(document.getElementById('apr-scope-type')?.value || 'brand').trim();
            const scopeKey = String(document.getElementById('apr-scope-key')?.value || '').trim();
            if (scopeType !== 'tenant' && !scopeKey) {
                showNotification('请填写范围键（品牌 key 或门店名）', 'warning');
                return;
            }
            const rules = {
                monthlyRestDays: Number(document.getElementById('apr-monthly-rest')?.value || 4),
                pointsYuanPerPoint: Number(document.getElementById('apr-points-rate')?.value || 0.5),
                payDayOfMonth: Number(document.getElementById('apr-pay-day')?.value || 15),
                approvedLeaveAuthoritative: !!document.getElementById('apr-leave-auth')?.checked,
                oweLeaveStillFullAttendance: !!document.getElementById('apr-owe-full')?.checked,
                offsetMissingWithRemainingLeave: !!document.getElementById('apr-offset-leave')?.checked,
                manualSubsidyAddsWithPoints: !!document.getElementById('apr-subsidy-add')?.checked,
                dailyRateDenominator: 'month_days_minus_rest',
                weeklyRestSource: 'daily_report',
                promotionEffective: 'next_month_first',
                ledgerBizMonthSource: 'business_occurrence',
                midMonthProration: 'active_calendar_days',
                attendanceMode: 'schedule_plus_complete_punch',
                noPunchWithSchedule: 'auto_rest',
                punchWithoutSchedule: 'abnormal_confirm',
                requireClockInAndOut: true
            };
            try {
                const resp = await fetch('/api/hrms/attendance-payroll-rules', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + (localStorage.getItem('hrms_token') || '')
                    },
                    body: JSON.stringify({ scopeType, scopeKey, rules })
                }).then((r) => r.json());
                if (!resp?.ok) throw new Error(resp?.error || 'save_failed');
                showNotification('考勤薪资规则已保存', 'success');
                await loadAttendancePayrollRulesSettings();
            } catch (e) {
                showNotification('保存失败：' + String(e?.message || e), 'error');
            }
        }

        async function setPayrollMonthRunStatus(status) {
            const month = String(document.getElementById('rep-month')?.value || '').trim();
            const store = String(document.getElementById('rep-store')?.value || '').trim();
            if (!month) {
                showNotification('请先选择薪资月份', 'warning');
                return;
            }
            try {
                const resp = await fetch('/api/hrms/payroll/month-run/status', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + (localStorage.getItem('hrms_token') || '')
                    },
                    body: JSON.stringify({ month, store, status })
                }).then((r) => r.json());
                if (!resp?.ok) throw new Error(resp?.error || 'failed');
                showNotification('月结状态已更新：' + status, 'success');
                loadReportsData();
            } catch (e) {
                showNotification('月结状态更新失败：' + String(e?.message || e), 'error');
            }
        }

        async function confirmPayrollAttendanceAbnormal(username, workDate, choice) {
            try {
                const resp = await fetch('/api/hrms/attendance-day/confirm', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + (localStorage.getItem('hrms_token') || '')
                    },
                    body: JSON.stringify({ username, workDate, choice })
                }).then((r) => r.json());
                if (!resp?.ok) throw new Error(resp?.error || 'failed');
                showNotification('已确认：' + choice, 'success');
                loadReportsData();
            } catch (e) {
                showNotification('确认失败：' + String(e?.message || e), 'error');
            }
        }

        function backToSettingsOverview() {
            document.querySelectorAll('#settings-page .settings-rep-sec').forEach((el) => { el.style.display = 'none'; });
            const backBtn = document.getElementById('settings-back-btn');
            if (backBtn) backBtn.style.display = 'none';
            const overview = document.getElementById('settings-overview');
            if (overview) overview.style.display = '';
            window.scrollTo(0, 0);
        }

        async function loadPermissionGroupsForSettings() {
            await loadPermissionGroupsFromServer();
            renderPermissionGroupsList();
            renderPermissionGroupAssignSelect();
            try { await loadPermissionPolicySettings(); } catch (_) {}
            __pgWireScopeModeRadios('pg-edit-scope-mode', 'pg-edit');
            __pgWireScopeModeRadios('pg-override-scope-mode', 'pg-override');
            __pgPopulateBrandSelect(document.getElementById('pg-override-scope-brand'));
            __pgRenderStoreCheckboxes(document.getElementById('pg-override-scope-stores'));
        }

        // ── 岗位"门店范围"选择器的共用小工具 ──────────────────────────────
        function __pgAllStoreNames() {
            const stores = (HRMS_STORE.getStores ? HRMS_STORE.getStores() : []) || [];
            return stores.map(s => String(s?.name || '').trim()).filter(Boolean);
        }
        function __pgAllRegions() {
            const stores = (HRMS_STORE.getStores ? HRMS_STORE.getStores() : []) || [];
            const set = new Set(stores.map(s => String(s?.region || '').trim()).filter(Boolean));
            return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
        }
        function __pgPopulateBrandSelect(selectEl, selectedId) {
            if (!selectEl) return;
            const brands = Array.isArray(__BRANDS_CACHE) ? __BRANDS_CACHE : [];
            selectEl.innerHTML = brands.map(b => '<option value="' + escapeHtml(String(b.id)) + '">' + escapeHtml(String(b.name || b.id)) + '</option>').join('');
            if (selectedId) selectEl.value = selectedId;
        }
        function __pgRenderStoreCheckboxes(containerEl, checkedList) {
            if (!containerEl) return;
            const names = __pgAllStoreNames();
            const checked = Array.isArray(checkedList) ? checkedList : [];
            containerEl.innerHTML = names.map(name =>
                '<label><input type="checkbox" value="' + escapeHtml(name) + '" ' + (checked.includes(name) ? 'checked' : '') + '> ' + escapeHtml(name) + '</label>'
            ).join('');
        }
        function __pgApplyScopeModeVisibility(prefix, mode) {
            const brandWrap = document.getElementById(prefix + '-scope-brand-wrap');
            const regionWrap = document.getElementById(prefix + '-scope-region-wrap');
            const storesWrap = document.getElementById(prefix + '-scope-stores-wrap');
            if (brandWrap) brandWrap.style.display = mode === 'brand' ? '' : 'none';
            if (regionWrap) regionWrap.style.display = mode === 'region' ? '' : 'none';
            if (storesWrap) storesWrap.style.display = mode === 'stores' ? '' : 'none';
        }
        function __pgWireScopeModeRadios(radioName, prefix) {
            document.querySelectorAll('input[name="' + radioName + '"]').forEach(r => {
                r.onchange = function () { __pgApplyScopeModeVisibility(prefix, this.value); };
            });
        }
        function __pgScopeSummary(scope) {
            if (!scope || typeof scope !== 'object') return '跟随跨店绑定';
            const mode = String(scope.mode || 'legacy');
            if (mode === 'legacy') return '跟随跨店绑定';
            if (mode === 'all') return '全部门店';
            if (mode === 'brand') return '品牌：' + (scope.brand || '-');
            if (mode === 'region') return '区域：' + (scope.region || '-');
            if (mode === 'stores') return '指定' + (Array.isArray(scope.stores) ? scope.stores.length : 0) + '家门店';
            return '跟随跨店绑定';
        }

        // 底部导航选择器：点击模块按钮按点击顺序加入(最多4个)，再点一次就移除——
        // 比手填逗号字符串好用，不用记key的拼写，也不会拼错。
        let __pgBottomNavSelection = [];
        function __pgBottomNavLabel(key) {
            if (key === 'profile') return '我的档案';
            const m = _allMods.find(x => x.p === key);
            return m ? m.l : key;
        }
        function __pgRenderBottomNavPicker() {
            const box = document.getElementById('pg-edit-bottom-nav-picker');
            const inputEl = document.getElementById('pg-edit-bottom-nav');
            if (inputEl) {
                inputEl.value = __pgBottomNavSelection.length
                    ? __pgBottomNavSelection.map((k, i) => (i + 1) + '.' + __pgBottomNavLabel(k)).join('  ')
                    : '';
            }
            if (!box) return;
            const candidates = [{ p: 'profile', l: '我的档案' }].concat(_allMods);
            box.innerHTML = candidates.map(m => {
                const idx = __pgBottomNavSelection.indexOf(m.p);
                const picked = idx >= 0;
                const bg = picked ? 'background:#f59e0b;color:#1c1c1e;border-color:#f59e0b;' : 'background:rgba(255,255,255,0.06);color:rgba(226,232,240,0.85);border-color:rgba(255,255,255,0.15);';
                const tag = picked ? ('(' + (idx + 1) + ') ') : '';
                return '<button type="button" onclick="pgToggleBottomNavItem(\'' + escapeHtml(m.p) + '\')" ' +
                    'style="padding:4px 10px;font-size:12px;border-radius:14px;border:1px solid;cursor:pointer;' + bg + '">' +
                    escapeHtml(tag + m.l) + '</button>';
            }).join('');
        }
        function pgToggleBottomNavItem(key) {
            const idx = __pgBottomNavSelection.indexOf(key);
            if (idx >= 0) {
                __pgBottomNavSelection.splice(idx, 1);
            } else {
                if (__pgBottomNavSelection.length >= 4) { showNotification('底部导航最多4个', 'warning'); return; }
                __pgBottomNavSelection.push(key);
            }
            __pgRenderBottomNavPicker();
        }
        function clearPgBottomNav() {
            __pgBottomNavSelection = [];
            __pgRenderBottomNavPicker();
        }

        function renderPermissionGroupsList() {
            const box = document.getElementById('permission-groups-list');
            if (!box) return;
            const groups = Array.isArray(_serverPermissionGroups) ? _serverPermissionGroups : [];
            if (!groups.length) {
                box.innerHTML = '<div class="settings-hint">还没有自定义权限组，员工都按角色默认权限。</div>';
                return;
            }
            box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
                '<thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6)">岗位名称</th>' +
                '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6)">基线角色</th>' +
                '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6)">模块数</th>' +
                '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6)">门店范围</th>' +
                '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6)">操作</th></tr></thead><tbody>' +
                groups.map(g => {
                    const roleLabel = (_edRoles.find(r => r.c === g.baseRole) || {}).l || g.baseRole || '-';
                    return '<tr>' +
                        '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);color:#e0e8f0">' + escapeHtml(String(g.name || '')) + '</td>' +
                        '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);color:#e0e8f0">' + escapeHtml(roleLabel) + '</td>' +
                        '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);color:#e0e8f0">' + (Array.isArray(g.modules) ? g.modules.length : 0) + '</td>' +
                        '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);color:#e0e8f0">' + escapeHtml(__pgScopeSummary(g.storeScope)) + '</td>' +
                        '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;">' +
                            '<button class="btn btn-secondary" type="button" style="padding:4px 10px;font-size:12px;" onclick="openPermissionGroupEditor(\'' + escapeHtml(String(g.id)) + '\')">编辑</button> ' +
                            '<button class="btn btn-secondary" type="button" style="padding:4px 10px;font-size:12px;" onclick="deletePermissionGroup(\'' + escapeHtml(String(g.id)) + '\')">删除</button>' +
                        '</td>' +
                    '</tr>';
                }).join('') +
                '</tbody></table>';
        }

        function renderPermissionGroupAssignSelect() {
            const sel = document.getElementById('pg-assign-group');
            if (!sel) return;
            const groups = Array.isArray(_serverPermissionGroups) ? _serverPermissionGroups : [];
            sel.innerHTML = '<option value="">（取消分配，恢复角色默认）</option>' +
                groups.map(g => '<option value="' + escapeHtml(String(g.id)) + '">' + escapeHtml(String(g.name || g.id)) + '</option>').join('');
        }

        function openPermissionGroupEditor(groupId) {
            const editor = document.getElementById('permission-group-editor');
            if (!editor) return;
            const groups = Array.isArray(_serverPermissionGroups) ? _serverPermissionGroups : [];
            const g = groupId ? groups.find(x => String(x.id) === String(groupId)) : null;
            const idEl = document.getElementById('pg-edit-id');
            const nameEl = document.getElementById('pg-edit-name');
            if (idEl) idEl.value = g ? String(g.id) : '';
            if (nameEl) nameEl.value = g ? String(g.name || '') : '';
            const roleSel = document.getElementById('pg-edit-base-role');
            if (roleSel) {
                roleSel.innerHTML = _edRoles.map(r => '<option value="' + escapeHtml(r.c) + '">' + escapeHtml(r.l) + '</option>').join('');
                roleSel.value = g ? String(g.baseRole || '') : (_edRoles[0] ? _edRoles[0].c : '');
            }
            const modsBox = document.getElementById('pg-edit-modules');
            if (modsBox) {
                const checked = g && Array.isArray(g.modules) ? g.modules : [];
                modsBox.innerHTML = _allMods.map(m =>
                    '<label><input type="checkbox" value="' + escapeHtml(m.p) + '" ' + (checked.includes(m.p) ? 'checked' : '') + '> ' + escapeHtml(m.l) + '</label>'
                ).join('');
            }
            const permBox = document.getElementById('pg-edit-permissions');
            if (permBox) {
                const checkedPerms = g && Array.isArray(g.permissions) ? g.permissions : [];
                permBox.innerHTML = _PAYROLL_PERMISSION_OPTIONS.map((p) =>
                    '<label><input type="checkbox" value="' + escapeHtml(p.id) + '" ' + (checkedPerms.includes(p.id) ? 'checked' : '') + '> ' + escapeHtml(p.label) + '</label>'
                ).join('');
            }
            const actions = (g && g.actions && typeof g.actions === 'object') ? g.actions : {};
            const approveEl = document.getElementById('pg-edit-action-approve');
            const viewEmpEl = document.getElementById('pg-edit-action-view-emp');
            if (approveEl) approveEl.checked = !!actions.can_approve_hrms;
            if (viewEmpEl) viewEmpEl.checked = !!actions.can_view_employees;
            __pgBottomNavSelection = (g && Array.isArray(g.bottomNav)) ? g.bottomNav.slice(0, 4) : [];
            __pgRenderBottomNavPicker();

            const scope = (g && g.storeScope && typeof g.storeScope === 'object') ? g.storeScope : { mode: 'legacy' };
            const scopeMode = String(scope.mode || 'legacy');
            document.querySelectorAll('input[name="pg-edit-scope-mode"]').forEach(r => { r.checked = (r.value === scopeMode); });
            __pgPopulateBrandSelect(document.getElementById('pg-edit-scope-brand'), scope.brand);
            const regionInput = document.getElementById('pg-edit-scope-region');
            if (regionInput) regionInput.value = scope.region || '';
            __pgRenderStoreCheckboxes(document.getElementById('pg-edit-scope-stores'), scope.stores);
            __pgApplyScopeModeVisibility('pg-edit', scopeMode);

            editor.style.display = '';
            editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        function closePermissionGroupEditor() {
            const editor = document.getElementById('permission-group-editor');
            if (editor) editor.style.display = 'none';
        }

        async function savePermissionGroup() {
            const id = String(document.getElementById('pg-edit-id')?.value || '').trim();
            const name = String(document.getElementById('pg-edit-name')?.value || '').trim();
            if (!name) { showNotification('请填写岗位名称', 'warning'); return; }
            const baseRole = String(document.getElementById('pg-edit-base-role')?.value || '').trim();
            const modules = Array.from(document.querySelectorAll('#pg-edit-modules input[type=checkbox]:checked')).map(cb => cb.value);
            const permissions = Array.from(document.querySelectorAll('#pg-edit-permissions input[type=checkbox]:checked')).map(cb => cb.value);
            const actions = {
                can_approve_hrms: !!document.getElementById('pg-edit-action-approve')?.checked,
                can_view_employees: !!document.getElementById('pg-edit-action-view-emp')?.checked
            };
            const bottomNav = __pgBottomNavSelection.slice(0, 4);
            const scopeModeEl = document.querySelector('input[name="pg-edit-scope-mode"]:checked');
            const scopeMode = scopeModeEl ? scopeModeEl.value : 'legacy';
            const storeScope = { mode: scopeMode };
            if (scopeMode === 'brand') storeScope.brand = String(document.getElementById('pg-edit-scope-brand')?.value || '').trim();
            if (scopeMode === 'region') storeScope.region = String(document.getElementById('pg-edit-scope-region')?.value || '').trim();
            if (scopeMode === 'stores') storeScope.stores = Array.from(document.querySelectorAll('#pg-edit-scope-stores input[type=checkbox]:checked')).map(cb => cb.value);

            const groups = Array.isArray(_serverPermissionGroups) ? _serverPermissionGroups.slice() : [];
            if (id) {
                const idx = groups.findIndex(g => String(g.id) === id);
                if (idx >= 0) groups[idx] = { ...groups[idx], name, baseRole, modules, permissions, actions, bottomNav, storeScope };
            } else {
                groups.push({ id: 'pg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, baseRole, modules, permissions, actions, bottomNav, storeScope });
            }
            try {
                const tok = localStorage.getItem('hrms_token') || '';
                const r = await fetch('/api/permission-groups', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
                    body: JSON.stringify({ groups })
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                _serverPermissionGroups = groups;
                renderPermissionGroupsList();
                renderPermissionGroupAssignSelect();
                closePermissionGroupEditor();
                showNotification('岗位已保存', 'success');
            } catch (e) {
                showNotification('保存失败：' + (e?.message || e), 'error');
            }
        }

        async function deletePermissionGroup(groupId) {
            const ok = await hrmsConfirm({ title: '删除权限组', message: '确定删除这个权限组？已分配到这个组的员工会恢复角色默认权限。', okText: '确认删除', icon: '🗑️' });
            if (!ok) return;
            const groups = (Array.isArray(_serverPermissionGroups) ? _serverPermissionGroups : []).filter(g => String(g.id) !== String(groupId));
            try {
                const tok = localStorage.getItem('hrms_token') || '';
                const r = await fetch('/api/permission-groups', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
                    body: JSON.stringify({ groups })
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                _serverPermissionGroups = groups;
                renderPermissionGroupsList();
                renderPermissionGroupAssignSelect();
                showNotification('已删除', 'success');
            } catch (e) {
                showNotification('删除失败：' + (e?.message || e), 'error');
            }
        }

        async function assignEmployeesToPermissionGroup() {
            const groupId = String(document.getElementById('pg-assign-group')?.value || '').trim();
            const raw = String(document.getElementById('pg-assign-usernames')?.value || '').trim();
            const usernames = raw.split(',').map(s => s.trim()).filter(Boolean);
            const statusEl = document.getElementById('pg-assign-status');
            if (!usernames.length) { showNotification('请填写至少一个用户名', 'warning'); return; }
            try {
                const tok = localStorage.getItem('hrms_token') || '';
                const r = await fetch('/api/permission-groups/assign', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
                    body: JSON.stringify({ groupId, usernames })
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d?.error || ('HTTP ' + r.status));
                if (statusEl) statusEl.textContent = '已更新 ' + (d.updated || 0) + ' 名员工（' + usernames.length + ' 个用户名中）';
                showNotification('分配完成', 'success');
            } catch (e) {
                if (statusEl) statusEl.textContent = '分配失败：' + (e?.message || e);
                showNotification('分配失败：' + (e?.message || e), 'error');
            }
        }

        // 单独覆盖某个员工的门店范围——同一个岗位下，不同员工可以管不同的门店/品牌/区域
        async function overrideEmployeeStoreScope() {
            const raw = String(document.getElementById('pg-override-usernames')?.value || '').trim();
            const usernames = raw.split(',').map(s => s.trim()).filter(Boolean);
            const statusEl = document.getElementById('pg-override-status');
            if (!usernames.length) { showNotification('请填写至少一个用户名', 'warning'); return; }
            const modeEl = document.querySelector('input[name="pg-override-scope-mode"]:checked');
            const mode = modeEl ? modeEl.value : '';
            let storeScopeOverride = null;
            if (mode) {
                storeScopeOverride = { mode };
                if (mode === 'brand') storeScopeOverride.brand = String(document.getElementById('pg-override-scope-brand')?.value || '').trim();
                if (mode === 'region') storeScopeOverride.region = String(document.getElementById('pg-override-scope-region')?.value || '').trim();
                if (mode === 'stores') storeScopeOverride.stores = Array.from(document.querySelectorAll('#pg-override-scope-stores input[type=checkbox]:checked')).map(cb => cb.value);
            }
            try {
                const tok = localStorage.getItem('hrms_token') || '';
                const r = await fetch('/api/permission-groups/assign', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
                    body: JSON.stringify({ usernames, storeScopeOverride })
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d?.error || ('HTTP ' + r.status));
                if (statusEl) statusEl.textContent = '已更新 ' + (d.updated || 0) + ' 名员工的门店范围';
                showNotification('设置完成', 'success');
            } catch (e) {
                if (statusEl) statusEl.textContent = '设置失败：' + (e?.message || e);
                showNotification('设置失败：' + (e?.message || e), 'error');
            }
        }

        function getRoleModulePages(role) {
            const r = String(role || '').trim();
            if (r === ROLES.ADMIN) return null; // null means all modules
            if (_serverRoleModules && _serverRoleModules[r]) return _serverRoleModules[r];
            if (_defaultRoleModules[r]) return _defaultRoleModules[r];
            const src = _serverRoleModules || _defaultRoleModules;
            return src[ROLES.EMPLOYEE] || ['profile', 'attendance'];
        }

        function canAccessModulePage(pageName, role) {
            const page = String(pageName || '').trim();
            if (!currentUser && page !== 'profile') return false;
            if (hrmsIsAlwaysAllowedPage(page)) return true;

            // 系统管理类页面(用户/门店/角色/系统设置)是真正的硬安全边界，任何自定义岗位
            // 都不能绕过——只认最底层系统角色是不是 admin，避免把某个岗位配置成"伪admin"
            // 拿到用户管理/系统设置的权限。这是唯一一条排在岗位覆盖之前的判断。
            if (page === 'users' || page === 'stores' || page === 'roles' || page === 'settings') {
                return hrmsIsRoleAdmin(role == null ? currentUser?.role : role);
            }

            // 自定义岗位（权限组）覆盖：分配了岗位的员工，模块可见范围完全以岗位里勾选的
            // 模块为准，取代下面所有按系统角色硬编码的特殊判断（知识库/增长/异常诊断/
            // Agent任务/策略/日报/审批等）——这样岗位才是真正能自由定义的"自定义角色"，
            // 不是只能在角色默认列表上打补丁。未分配岗位的员工完全不受影响，继续走角色
            // 硬编码逻辑，对洪潮/马己仙现有数据零影响。
            if (role == null && currentUser?.permissionGroupId) {
                const grp = (Array.isArray(_serverPermissionGroups) ? _serverPermissionGroups : [])
                    .find(g => String(g?.id || '') === String(currentUser.permissionGroupId));
                if (grp) {
                    const em = String(currentUser?.enforcement_mode || 'legacy').trim() || 'legacy';
                    if ((em === 'strict' || em === 'hybrid') && page === 'reports') {
                        return hrmsHasPermission('module.reports');
                    }
                    return Array.isArray(grp.modules) && grp.modules.includes(page);
                }
            }

            if ((String(currentUser?.enforcement_mode || 'legacy') === 'strict' || String(currentUser?.enforcement_mode || 'legacy') === 'hybrid') && page === 'reports') {
                return hrmsHasPermission('module.reports');
            }

            // 知识库仅 admin 可访问（用于上传培训资料，其他角色不可见）
            if (page === 'knowledge') {
                const r = String(role == null ? currentUser?.role : role || '').trim();
                return r === ROLES.ADMIN;
            }
            if (page === 'forecast' || page === 'agents') {
                return hrmsCanAccessSmartAssistant(role == null ? currentUser?.role : role);
            }
            if (page === 'agent-tasks') {
                const r = String(role == null ? currentUser?.role : role || '').trim();
                return r === ROLES.ADMIN || r === ROLES.HQ_MANAGER || r === ROLES.HR_MANAGER;
            }
            if (page === 'task-performance') {
                const r = String(role == null ? currentUser?.role : role || '').trim();
                return r === ROLES.ADMIN || r === ROLES.HQ_MANAGER || r === ROLES.HR_MANAGER;
            }
            if (page === 'growth') {
                const r = String(role == null ? currentUser?.role : role || '').trim();
                return r === ROLES.ADMIN;
            }
            if (page === 'diagnosis') {
                const r = String(role == null ? currentUser?.role : role || '').trim();
                return r === ROLES.ADMIN;
            }
            if (page === 'strategy') {
                const r = String(role == null ? currentUser?.role : role || '').trim();
                return r === ROLES.ADMIN || r === ROLES.HQ_MANAGER || r === ROLES.STORE_MANAGER || r === ROLES.PRODUCTION_MANAGER;
            }
            if (page === 'daily-report') {
                const r = String(role == null ? currentUser?.role : role || '').trim();
                return r === ROLES.ADMIN || r === ROLES.HQ_MANAGER || r === ROLES.STORE_MANAGER || r === ROLES.FRONT_MANAGER || r === ROLES.FRONT_SUPERVISOR;
            }
            // 出品经理需审批后厨晋升等单据：固定开放「待审批」模块，不依赖可变的角色模块配置
            if (page === 'approvals') {
                const r = String(role == null ? currentUser?.role : role || '').trim();
                if (r === ROLES.PRODUCTION_MANAGER) return true;
            }
            const pages = getRoleModulePages(role == null ? currentUser?.role : role);
            if (pages === null) return true;
            return Array.isArray(pages) && pages.includes(page);
        }

        function getRoleBottomNavPages(role) {
            const r = String(role || '').trim();
            // 自定义岗位优先：分配了岗位且岗位设置了底部导航的话，以岗位为准——
            // 这样自定义岗位才算真正意义上的"自定义角色"，不被角色写死的导航栏限制。
            if (currentUser?.permissionGroupId && r === String(currentUser?.role || '').trim()) {
                const grp = (Array.isArray(_serverPermissionGroups) ? _serverPermissionGroups : [])
                    .find(g => String(g?.id || '') === String(currentUser.permissionGroupId));
                if (grp && Array.isArray(grp.bottomNav) && grp.bottomNav.length) return grp.bottomNav;
            }
            if (r === ROLES.ADMIN) return ['profile', 'growth', 'reports', 'agent-tasks'];
            if (r === ROLES.STORE_MANAGER) return ['profile', 'attendance', 'payment', 'approvals'];
            if (r === ROLES.PRODUCTION_MANAGER) return ['profile', 'attendance', 'kitchen', 'training'];
            if (r === ROLES.HQ_MANAGER) return ['profile', 'approvals', 'reports'];
            if (r === ROLES.HR_MANAGER) return ['profile', 'employees', 'approvals', 'reports'];
            if (r === ROLES.CASHIER) return ['profile', 'attendance', 'payment', 'exam'];
            if (r === ROLES.FRONT_MANAGER) return ['profile', 'daily-report', 'attendance', 'exam'];
            if (r === ROLES.FRONT_SUPERVISOR) return ['profile', 'daily-report', 'attendance', 'exam'];
            return ['profile', 'attendance', 'kitchen', 'training'];
        }

        function getHomePageName() {
            return 'profile';
        }

        function getAllowedStoresForUser() {
            const stores = Array.isArray(currentUser?.allowed_stores) ? currentUser.allowed_stores : [];
            return stores.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
        }

        function hydrateCurrentUserFromApiUser(u) {
            if (!u) return null;
            const employees = HRMS_STORE.getEmployees() || [];
            const users = HRMS_STORE.getUsers() || [];
            const empInfo = employees.find(e => String(e?.username || '').toLowerCase() === String(u.username || '').toLowerCase()) || {};
            const userInfo = users.find(x => x && String(x.username || '').toLowerCase() === String(u.username || '').toLowerCase()) || {};
            const managerUsername = (empInfo.managerUsername || empInfo.manager || u.managerUsername || '').trim();
            const managerRec = managerUsername
                ? (employees.find(e => String(e?.username || '').toLowerCase() === managerUsername.toLowerCase()) ||
                   users.find(x => String(x?.username || '').toLowerCase() === managerUsername.toLowerCase()) || {})
                : {};
            return {
                id: u.id,
                username: u.username,
                name: empInfo.name || u.name || u.username,
                role: hrmsNormalizeRoleCode(u.role),
                store: String(u.current_store || empInfo.store || u.store || '').trim(),
                current_store: String(u.current_store || u.store || empInfo.store || '').trim(),
                primary_store: String(u.primary_store || u.store || empInfo.store || '').trim(),
                allowed_stores: Array.isArray(u.allowed_stores) ? u.allowed_stores : [],
                position: empInfo.position || u.position || userInfo.position || '',
                department: empInfo.department || u.department || userInfo.department || '',
                level: empInfo.level || empInfo.jobLevel || empInfo.rank || u.level || '',
                joinDate: empInfo.joinDate || empInfo.hireDate || empInfo.entryDate || u.joinDate || '',
                managerUsername,
                managerName: String(managerRec.name || empInfo.managerName || u.managerName || '').trim(),
                status: 'active',
                permissionGroupId: String(u.permission_group_id || empInfo.permissionGroupId || '').trim() || null,
                enforcement_mode: String(u.enforcement_mode || 'legacy').trim() || 'legacy',
                permissions: Array.isArray(u.permissions) ? u.permissions.slice() : []
            };
        }

        function hrmsHasPermission(permission) {
            const perm = String(permission || '').trim();
            if (!perm || !currentUser) return false;
            const mode = String(currentUser.enforcement_mode || 'legacy').trim() || 'legacy';
            const perms = Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
            if (mode === 'hybrid' || mode === 'strict') {
                return perms.includes('*') || perms.includes(perm);
            }
            return false;
        }

        function hrmsPayrollPermAllowed(permission, legacyRoleCheck) {
            const mode = String(currentUser?.enforcement_mode || 'legacy').trim() || 'legacy';
            if (mode === 'hybrid' || mode === 'strict') return hrmsHasPermission(permission);
            return !!legacyRoleCheck;
        }

        async function switchCurrentUserStore(nextStore) {
            const store = String(nextStore || '').trim();
            if (!currentUser || !store) return;
            const allowed = getAllowedStoresForUser();
            if (!allowed.includes(store)) {
                showNotification('该门店不在当前账号可切换范围内', 'warning');
                return;
            }
            try {
                const resp = await HRMS_API.switchStore(store);
                if (resp?.token) HRMS_API.setToken(resp.token);
                // 切换门店后必须重新拉取 /api/state：服务端按新 current_store 重新裁剪
                // 员工/用户名册，否则前端仍是旧门店上下文的缓存，按新门店一过滤即为空，
                // 表现为「进入该门店看不到任何员工」。
                try { await hrmsLoadStateFromServer(); } catch (e) {}
                if (resp?.user) currentUser = hydrateCurrentUserFromApiUser(resp.user);
                // Reset page-level store select caches so they rebuild with new store
                if (typeof __REP_STORE_POPULATED !== 'undefined') __REP_STORE_POPULATED = false;
                ['dr-store', 'rep-store', 'rep-brand'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el && el.disabled) {
                        el.innerHTML = `<option value="${escapeHtml(store)}">${escapeHtml(store)}</option>`;
                        el.value = store;
                    }
                });
                updateUserInfo();
                if (typeof closeMobileMoreMenu === 'function') closeMobileMoreMenu();
                showNotification('已切换到 ' + store, 'success');
                showPage(currentPage || getHomePageName());
            } catch (e) {
                showNotification('切换门店失败: ' + (e?.message || e), 'error');
            }
        }

