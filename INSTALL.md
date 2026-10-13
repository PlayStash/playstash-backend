# How to Set Up PlayStash Backend for Local Development

For a fresh PlayStash installation, use an empty database and the PlayStash Docker Compose examples.

To generate the frontend API specification from this backend without starting a server or connecting to a database, run `pnpm export:openapi ../playstash-frontend/api-spec/playstash.openapi.json` after installing development dependencies.

Run `pnpm check:fresh-schema sqlite` to verify all migrations against an empty, in-memory SQLite database. To check PostgreSQL, set `PLAYSTASH_TEST_DATABASE_URL` to an empty test database and run `pnpm check:fresh-schema postgres`.

## What You Need

- [Git](https://git-scm.com/)
- [Node.js LTS](https://nodejs.org/)
- [pnpm](https://pnpm.io)
- [Visual Studio Code (\*)](https://code.visualstudio.com/)
- [Docker (\*)](https://www.docker.com/)

`Items with an asterisk (*) are optional, but recommended.`

## Steps to Get Started

1. **Clone the Repository**

   Open your terminal and run:

   ```bash
   git clone https://github.com/PlayStash/playstash-backend
   ```

2. **Go to the Project Folder**

   Navigate to the directory you just downloaded:

   ```bash
   cd playstash-backend
   ```

3. **Install the Required Dependencies**

   Install all necessary packages:

   ```bash
   pnpm install
   ```

4. **Set Up Your Environment**

   Copy the sample environment file:

   ```bash
   cp .dev.env .env
   ```

5. **Start the App or Run Tests**

   To start the app:

   ```bash
   pnpm start
   ```

   To run tests:

   ```bash
   pnpm test
   ```

## Contributing

Before contributing, please review and agree to the [Contributors License Agreement](CONTRIBUTING.md) and the [License](LICENSE.md).
