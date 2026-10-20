# Схема базы данных AirWay

AirWay использует **Cloud Firestore**. Данные разделены на коллекции по бизнес-сущностям, а критические операции с местами выполняются атомарно через Firestore Transaction.

## 1. Коллекции

### `users` — пользователи
- `uid` — ID документа = Firebase Authentication UID
- `name` — имя пользователя
- `email` — Email
- `phone` — телефон
- `role` — `user` или `admin`
- `createdAt`, `updatedAt` — даты

### `flights` — каталог рейсов
- `flightNumber`, `airline`
- `from`, `to` — IATA-коды
- `fromCity`, `toCity` — города
- `departureDate`, `departureTime`, `arrivalTime`
- `duration`, `price`, `baggage`
- `seats` — текущее число свободных мест
- `totalSeats` — исходная вместимость
- `class` — `Economy` / `Business`
- `stops` — количество пересадок
- `status` — `available`, `sold_out`, `cancelled`
- `description`
- `createdAt`, `updatedAt`

### `cart` — корзина
- `userId` — владелец
- `flightId` — выбранный рейс
- сохранённые данные маршрута и тарифа
- `price` — цена на момент добавления
- `quantity` — от 1 до 5 пассажиров
- `createdAt`

### `bookings` — оформленные бронирования
- `userId`, `flightId`
- данные рейса и тарифа фиксируются при оформлении
- `price`, `sourcePrice`
- `quantity`
- `passengers[]` — данные пассажиров: имя, фамилия, дата рождения, документ, телефон, предпочтение места
- `bookingCode` — человекочитаемый код бронирования
- `ticketCode` — код электронного билета
- `status` — `pending`, `confirmed`, `completed`, `cancelled`
- `isDemo` — признак учебного демо-рейса
- `createdAt`, `updatedAt`, `cancelledAt`

### `reviews` — отзывы
- `userId`, `userName`
- `flightId`
- `rating` — 1–5
- `text`
- `createdAt`

### `activityLogs` — журнал действий
Используется для демонстрации аудита операций:
- `userId`
- `action`
- `bookingId` / `flightId` / `reviewId` — при необходимости
- `source` — `user` или `admin`
- `createdAt`

## 2. Связи

- `users.uid` → `cart.userId`
- `users.uid` → `bookings.userId`
- `users.uid` → `reviews.userId`
- `users.uid` → `activityLogs.userId`
- `flights.id` → `cart.flightId`
- `flights.id` → `bookings.flightId`
- `flights.id` → `reviews.flightId`

В `cart` и `bookings` часть данных рейса денормализована. Благодаря этому история заказа остаётся читаемой даже после изменения карточки рейса.

## 3. Атомарное бронирование

Для реального Firebase-рейса оформление выполняется одной транзакцией:

1. Читается актуальный документ `flights/{flightId}`.
2. Проверяется число свободных мест.
3. `seats` уменьшается на количество пассажиров.
4. Создаётся `bookings/{bookingId}`.
5. Создаётся запись `activityLogs`.
6. Удаляется позиция из `cart`.

Если хотя бы один шаг невозможен, транзакция не фиксируется целиком. Это предотвращает бронирование последнего места двумя пользователями одновременно.

При отмене собственного бронирования выполняется обратная операция — место возвращается рейсу.

## 4. Индексы и запросы

В `firestore.indexes.json` настроены составные индексы для:
- `bookings`: `userId ASC + createdAt DESC`
- `cart`: `userId ASC + flightId ASC`
- `reviews`: `flightId ASC + createdAt DESC`
- `flights`: `departureDate ASC + price ASC`

Каталог использует cursor pagination: `limit()` + `startAfter()`.
Админ-панель использует постраничную загрузку коллекций.
Статистика использует `getCountFromServer()` вместо загрузки всех документов.

## 5. Безопасность

- Firebase Authentication отвечает за идентификацию.
- Роль хранится в `users/{uid}.role`.
- Пользователь не может назначить себе `admin`.
- Пользователь читает только собственные корзину и бронирования.
- Пользователь может отменять только свои бронирования.
- Изменение маршрута, цены и расписания рейса доступно администратору.
- Для пользовательского бронирования разрешено только ограниченное атомарное изменение количества свободных мест.
- Администратор имеет отдельные права для управления рейсами, заказами, пользователями, отзывами и журналом действий.
