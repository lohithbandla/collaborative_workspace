const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.io
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());

// Store whiteboard state
let whiteboardState = {
  shapes: [],
  history: [[]],
  historyIndex: 0
};

// Store connected users
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Add user to connected users
  connectedUsers.set(socket.id, {
    id: socket.id,
    cursor: { x: 0, y: 0 },
    color: getRandomColor(),
    isDrawing: false
  });

  // Send current whiteboard state to newly connected user
  socket.emit('whiteboard-state', whiteboardState);
  
  // Send current users list
  socket.emit('users-update', Array.from(connectedUsers.values()));
  
  // Broadcast user joined to others
  socket.broadcast.emit('user-joined', connectedUsers.get(socket.id));

  // Handle shape drawing
  socket.on('shape-update', (data) => {
    // Update whiteboard state
    if (data.type === 'add') {
      whiteboardState.shapes.push(data.shape);
    } else if (data.type === 'update') {
      const index = whiteboardState.shapes.findIndex(s => s.id === data.shape.id);
      if (index !== -1) {
        whiteboardState.shapes[index] = data.shape;
      }
    } else if (data.type === 'delete') {
      whiteboardState.shapes = whiteboardState.shapes.filter(s => s.id !== data.shapeId);
    } else if (data.type === 'clear') {
      whiteboardState.shapes = [];
    } else if (data.type === 'replace-all') {
      whiteboardState.shapes = data.shapes;
    }
    
    // Broadcast to all other clients
    socket.broadcast.emit('shape-update', data);
  });

  // Handle drawing state (for real-time drawing feedback)
  socket.on('drawing-state', (data) => {
    // Update user's drawing state
    if (connectedUsers.has(socket.id)) {
      connectedUsers.get(socket.id).isDrawing = data.isDrawing;
      connectedUsers.get(socket.id).currentShape = data.currentShape;
    }
    
    // Broadcast drawing state to others
    socket.broadcast.emit('user-drawing', {
      userId: socket.id,
      ...data
    });
  });

  // Handle cursor movement
  socket.on('cursor-move', (data) => {
    if (connectedUsers.has(socket.id)) {
      connectedUsers.get(socket.id).cursor = data;
    }
    
    socket.broadcast.emit('user-cursor', {
      userId: socket.id,
      cursor: data
    });
  });

  // Handle tool selection
  socket.on('tool-change', (data) => {
    if (connectedUsers.has(socket.id)) {
      connectedUsers.get(socket.id).tool = data.tool;
    }
    
    socket.broadcast.emit('user-tool-change', {
      userId: socket.id,
      tool: data.tool
    });
  });

  // Handle history operations
  socket.on('history-update', (data) => {
    whiteboardState.history = data.history;
    whiteboardState.historyIndex = data.historyIndex;
    
    socket.broadcast.emit('history-update', data);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    connectedUsers.delete(socket.id);
    
    // Broadcast user left to others
    socket.broadcast.emit('user-left', socket.id);
    socket.broadcast.emit('users-update', Array.from(connectedUsers.values()));
  });
});

// Utility function to generate random colors for users
function getRandomColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF', '#5F27CD'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', users: connectedUsers.size });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io };