/** Fake memos and newsletters JSON for prompt test endpoint (no real DB). */
export const FAKE_MEMOS_JSON = JSON.stringify(
  [
    {
      id: 'm1',
      createdAt: '2026-02-18T10:00:00.000Z',
      transcript: 'Had a great morning run around the lake. Saw three deer. Weather was perfect. Took a photo of the sunrise over the water and a short video of the deer.',
      title: 'Morning run',
      attachmentSummary: 'Photo and video from lake run',
      attachments: [
        { id: 'att1', type: 'image', originalName: 'lake-sunrise.jpg', contentType: 'image/jpeg', sizeBytes: 245000, signedUrl: 'https://picsum.photos/id/10/400/300' },
        { id: 'att1b', type: 'video', originalName: 'deer-at-lake.mp4', contentType: 'video/mp4', sizeBytes: 1250000, signedUrl: 'https://www.w3schools.com/html/mov_bbb.mp4' },
      ],
    },
    {
      id: 'm2',
      createdAt: '2026-02-20T14:30:00.000Z',
      transcript: 'Finally finished that book I was reading. The ending was unexpected but satisfying.',
      title: 'Book finished',
      attachmentSummary: null,
      attachments: [],
    },
    {
      id: 'm3',
      createdAt: '2026-02-21T09:15:00.000Z',
      transcript: 'Tried a new recipe for dinner—spicy Thai noodles. Everyone loved it. Here is a pic of the final dish.',
      title: 'Dinner success',
      attachmentSummary: 'Photo of Thai noodles',
      attachments: [
        { id: 'att2', type: 'image', originalName: 'thai-noodles.jpg', contentType: 'image/jpeg', sizeBytes: 312000, signedUrl: 'https://picsum.photos/id/292/400/300' },
      ],
    },
    {
      id: 'm4',
      createdAt: '2026-02-22T16:00:00.000Z',
      transcript: 'Went for a hike at the state park. Trail was muddy but the views from the summit were worth it. Recorded a quick video of the panorama.',
      title: 'Weekend hike',
      attachmentSummary: 'Photo and video from trail summit',
      attachments: [
        { id: 'att3', type: 'image', originalName: 'hike-summit.jpg', contentType: 'image/jpeg', sizeBytes: 189000, signedUrl: 'https://picsum.photos/id/11/400/300' },
        { id: 'att3b', type: 'video', originalName: 'summit-panorama.mp4', contentType: 'video/mp4', sizeBytes: 2100000, signedUrl: 'https://www.w3schools.com/html/movie.mp4' },
      ],
    },
  ],
  null,
  2
);

export const FAKE_NEWSLETTERS_JSON = JSON.stringify(
  [
    { id: 'n1', subject: 'Last Week in Review', bodyMarkdown: 'A quiet week with some good reading...' },
    { id: 'n2', subject: 'Catching Up', bodyMarkdown: 'Work was busy but managed to squeeze in a hike...' },
  ],
  null,
  2
);
