# Websim Nativefier Bridge

This Node.js application acts as a local bridge between your Websim page and the `nativefier` command-line tool. It listens for build requests from your browser client and executes them on your local machine.

## Prerequisites

- [Node.js](https://nodejs.org/) (Version 18.x or newer is recommended)
- `npm` (comes with Node.js)

## Setup and Running

1.  **Unzip this project folder** to a location of your choice on your computer (e.g., your Desktop or Downloads folder).

2.  **Open a terminal or command prompt** and navigate into the unzipped `websim-nativefier-bridge` directory.

    *On Windows:* Open the folder, right-click inside it, and choose "Open in Terminal" or "Open PowerShell window here".
    *On Mac/Linux:* Open your Terminal application and use the `cd` command.
    ```sh
    # Example:
    cd ~/Downloads/websim-nativefier-bridge
    ```

3.  **Install the dependencies.** This will download `nativefier`, `ws`, and other required packages. This might take a few minutes. If you see warnings, you can usually ignore them.

    ```sh
    npm install
    ```

4.  **Run the server.**

    ```sh
    npm start
    ```

You should see a message saying `WebSocket server started on ws://localhost:3001`.

**That's it!** Keep this terminal window open. Go back to your Websim page in your browser. The status on the webpage should change from "Disconnected" to "Connected". If it doesn't, refresh the page.

