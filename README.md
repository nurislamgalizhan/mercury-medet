# Меркурий Медет — CRM для фитнес-студии

## Быстрый старт

### 1. База данных
```bash
# Создайте PostgreSQL базу данных
createdb mercury_medet
```

### 2. Бэкенд
```bash
cd backend
npm install
cp .env.example .env
# Отредактируйте .env — укажите DATABASE_URL

npx prisma migrate dev --name init
npx prisma generate
node prisma/seed.js   # Создаёт admin + тарифы

npm run dev           # http://localhost:4000
```

### 3. Фронтенд
```bash
cd frontend
npm install
npm run dev           # http://localhost:5173
```

## Деплой на сервер (общий nginx-шлюз)

`mmedet.kz` и `qr.bva.kz` живут на одном сервере за общим контейнером
`app-gateway-nginx`, который держит `80/443` и терминирует TLS. Шлюз ходит во
фронтенд по docker-сети `mercury-medet-app_default`, поэтому фронтенд **не должен**
публиковать `80` — иначе `up` упадёт с конфликтом порта и положит оба сайта.

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --build
```

Override монтирует продовый `frontend/nginx.conf`, в котором бэкенд объявлен через
`resolver` + `upstream`. Это важно: фронтенд BVA подключён к этой же сети, и имя
`backend` в ней неоднозначно — без `resolve` nginx может закешировать чужой адрес.

## Вход и сессии

Сессия скользящая. Токен живёт `JWT_EXPIRES_IN` (по умолчанию 30 дней), и как
только истекла половина срока, ответ API приносит новый токен в заголовке
`X-Session-Token` — фронтенд молча его сохраняет. Кто пользуется системой
регулярно, не логинится заново никогда; кто не заходил дольше полного срока,
входит обычным способом.

Сотрудникам после проверки кода из WhatsApp выдаётся токен доверенного
устройства на 30 дней: на этом браузере следующий вход просит только пароль.
Устройство не заменяет пароль — оно пропускает лишь второй фактор. В базе лежит
только SHA-256 хеш токена, а любая смена пароля (своя, временная или сброс
администратором) удаляет все доверенные устройства аккаунта, как и `tokenVersion`
обрывает все действующие сессии.

## Учётные данные администратора (seed)
- Телефон: `77000000000`
- Пароль: ``

## Стек
- **Backend:** Node.js + Express + Prisma (PostgreSQL) + Socket.io + Zod
- **Frontend:** React (Vite) + Tailwind CSS + React Router + Axios
- **Auth:** JWT, регистрация клиентов через администратора, WhatsApp MFA только для администратора

## API Endpoints

| Method | Path | Auth | Описание |
|--------|------|------|----------|
| POST | /api/auth/register | — | Заявка на регистрацию через администратора |
| POST | /api/auth/registration-status | — | Статус заявки на регистрацию |
| POST | /api/auth/login | — | Вход |
| POST | /api/auth/admin-mfa/verify | — | Подтверждение MFA администратора |
| POST | /api/auth/admin-mfa/resend | — | Повтор MFA-кода администратора |
| POST | /api/auth/forgot-password | — | Заявка администратору на сброс пароля |
| POST | /api/auth/complete-temporary-password | JWT | Замена временного пароля |
| GET | /api/auth/me | JWT | Текущий пользователь |
| GET | /api/users | Admin | Список клиентов |
| GET | /api/users/:id | Admin | Карточка клиента |
| POST | /api/users | Admin | Создать клиента |
| PATCH | /api/users/:id/adjust | Admin | Корректировка баланса |
| DELETE | /api/users/:id | Admin | Деактивация |
| GET | /api/tariffs | JWT | Тарифы |
| POST | /api/tariffs | Admin | Создать тариф |
| PATCH | /api/tariffs/:id | Admin | Обновить тариф |
| DELETE | /api/tariffs/:id | Admin | Деактивировать тариф |
| POST | /api/visits/checkin | JWT | Списание посещений |
| GET | /api/visits | Admin | Лог посещений |
| POST | /api/sales | Admin | Продать абонемент |
| GET | /api/sales | Admin | Лог продаж |
| GET | /api/verification-requests | Admin | Регистрации и запросы сброса пароля |
